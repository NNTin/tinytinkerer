import { z } from 'zod'
import type { Bindings } from './bindings'
import type { CallerIdentity } from './caller-validation'
import { fetchWithTimeout } from './fetch'
import { deriveCredentialKey, type CredentialKey } from './rate-limit'

const DEFAULT_USER_MAX_BUDGET_USD = 1
const DEFAULT_USER_BUDGET_DURATION = '30d'
const DEFAULT_USER_RPM_LIMIT = 10
const DEFAULT_USER_TPM_LIMIT = 100_000
const PROVISIONED_TTL_MS = 10 * 60_000

const keyInfoResponseSchema = z.object({
  info: z.array(
    z
      .object({
        key_alias: z.string().nullable().optional(),
        user_id: z.string().nullable().optional(),
        max_budget: z.number().nullable().optional(),
        budget_duration: z.string().nullable().optional(),
        rpm_limit: z.number().nullable().optional(),
        tpm_limit: z.number().nullable().optional(),
        models: z.array(z.string()).nullable().optional()
      })
      .passthrough()
  )
})

const generateKeyResponseSchema = z
  .object({
    key: z.string()
  })
  .passthrough()

export type LiteLLMUserKey = {
  apiKey: string
  keyAlias: string
  userId: string
  credentialKey: CredentialKey
}

type ExpectedKeyConfig = {
  keyAlias: string
  userId: string
  maxBudget: number
  budgetDuration: string
  rpmLimit: number
  tpmLimit: number
  models: string[]
  fingerprint: string
}

type KeyInfo = z.infer<typeof keyInfoResponseSchema>['info'][number]

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const provisionedUntilByScope = new Map<string, number>()

export const clearLiteLLMUserKeyCache = (credentialKey?: CredentialKey): void => {
  if (credentialKey) {
    for (const scope of provisionedUntilByScope.keys()) {
      if (scope.startsWith(`${credentialKey}:`)) provisionedUntilByScope.delete(scope)
    }
    return
  }
  provisionedUntilByScope.clear()
}

const provisionedCacheKey = (
  credentialKey: CredentialKey,
  fingerprint: string
): string =>
  `https://litellm-user-key-cache.tiny.nntin.xyz/${credentialKey}/${fingerprint}`

const PROVISIONED_UNTIL_HEADER = 'x-litellm-user-key-provisioned-until'

const readProvisionedMarker = async (
  credentialKey: CredentialKey,
  fingerprint: string,
  nowMs = Date.now()
): Promise<boolean> => {
  const scope = `${credentialKey}:${fingerprint}`
  const inMemoryUntil = provisionedUntilByScope.get(scope) ?? 0
  if (inMemoryUntil > nowMs) return true

  const store = cacheStore()
  if (!store) return false
  try {
    const hit = await store.match(provisionedCacheKey(credentialKey, fingerprint))
    if (!hit) return false
    const untilMs = Number(hit.headers.get(PROVISIONED_UNTIL_HEADER) ?? '0')
    if (untilMs <= nowMs) return false
    provisionedUntilByScope.set(scope, untilMs)
    return true
  } catch {
    return false
  }
}

const writeProvisionedMarker = async (
  credentialKey: CredentialKey,
  fingerprint: string,
  nowMs = Date.now()
): Promise<void> => {
  const untilMs = nowMs + PROVISIONED_TTL_MS
  provisionedUntilByScope.set(`${credentialKey}:${fingerprint}`, untilMs)

  const store = cacheStore()
  if (!store) return
  try {
    await store.put(
      provisionedCacheKey(credentialKey, fingerprint),
      new Response('', {
        headers: {
          'cache-control': `max-age=${Math.ceil(PROVISIONED_TTL_MS / 1000)}`,
          [PROVISIONED_UNTIL_HEADER]: String(untilMs)
        }
      })
    )
  } catch {
    // Best-effort: a failed marker write only means the next request re-checks LiteLLM.
  }
}

const toPositiveNumber = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const configuredModels = (env: Bindings): string[] =>
  (env.LITELLM_USER_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

const expectedConfig = (
  env: Bindings,
  identity: CallerIdentity
): ExpectedKeyConfig => {
  const models = configuredModels(env).sort()
  const maxBudget = toPositiveNumber(
    env.LITELLM_USER_MAX_BUDGET_USD,
    DEFAULT_USER_MAX_BUDGET_USD
  )
  const budgetDuration =
    env.LITELLM_USER_BUDGET_DURATION?.trim() || DEFAULT_USER_BUDGET_DURATION
  const rpmLimit = toPositiveNumber(
    env.LITELLM_USER_RPM_LIMIT,
    DEFAULT_USER_RPM_LIMIT
  )
  const tpmLimit = toPositiveNumber(
    env.LITELLM_USER_TPM_LIMIT,
    DEFAULT_USER_TPM_LIMIT
  )
  const userId = `github-${identity.id}`
  const keyAlias = `tinytinkerer-github-${identity.id}`
  const fingerprint = JSON.stringify({
    maxBudget,
    budgetDuration,
    rpmLimit,
    tpmLimit,
    models
  })

  return {
    keyAlias,
    userId,
    maxBudget,
    budgetDuration,
    rpmLimit,
    tpmLimit,
    models,
    fingerprint
  }
}

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

const deriveUserApiKey = async (
  env: Bindings,
  baseUrl: string,
  identity: CallerIdentity
): Promise<string> => {
  const secret = env.LITELLM_USER_KEY_SECRET?.trim()
  if (!secret) throw new Error('Missing LITELLM_USER_KEY_SECRET')

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(`tinytinkerer-litellm-user-key:v1:${baseUrl}:${identity.id}`)
  )
  return `sk-tt-${bytesToHex(new Uint8Array(signature)).slice(0, 48)}`
}

export const liteLLMUserCredentialKeyInput = (
  identity: CallerIdentity,
  baseUrl: string
): string => `litellm-user:${baseUrl}:github-${identity.id}`

const managementHeaders = (env: Bindings): Record<string, string> => ({
  authorization: `Bearer ${env.LITELLM_KEY_MANAGEMENT_API_KEY?.trim() ?? ''}`,
  'content-type': 'application/json',
  'litellm-changed-by': 'tinytinkerer-edge'
})

const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

const managementConfigured = (env: Bindings): boolean =>
  Boolean(env.LITELLM_KEY_MANAGEMENT_API_KEY?.trim()) &&
  Boolean(env.LITELLM_USER_KEY_SECRET?.trim())

export const requireLiteLLMUserKeyConfiguration = (
  env: Bindings
): string | undefined =>
  managementConfigured(env)
    ? undefined
    : 'LiteLLM user key provisioning is not configured.'

const readKeyInfoByAlias = async (
  env: Bindings,
  baseUrl: string,
  keyAlias: string
): Promise<KeyInfo | undefined> => {
  const response = await fetchWithTimeout(
    {
      area: 'litellm.key.info',
      origin: 'litellm',
      method: 'POST',
      url: appendPath(baseUrl, '/v2/key/info'),
      accept: {
        status: [404],
        reason:
          'A missing per-user LiteLLM key is expected before first-time provisioning.'
      }
    },
    {
      method: 'POST',
      headers: managementHeaders(env),
      body: JSON.stringify({ key_aliases: [keyAlias] })
    },
    10_000
  ).catch(() => undefined)

  if (!response?.ok) return undefined
  const parsed = keyInfoResponseSchema.safeParse(
    await response.json().catch(() => undefined)
  )
  if (!parsed.success) return undefined
  return parsed.data.info.find((entry) => entry.key_alias === keyAlias)
}

const keyNeedsUpdate = (
  info: KeyInfo,
  expected: ExpectedKeyConfig
): boolean => {
  const models = [...(info.models ?? [])].sort()
  return (
    info.user_id !== expected.userId ||
    info.max_budget !== expected.maxBudget ||
    info.budget_duration !== expected.budgetDuration ||
    info.rpm_limit !== expected.rpmLimit ||
    info.tpm_limit !== expected.tpmLimit ||
    !arraysEqual(models, expected.models)
  )
}

const updateKey = async (
  env: Bindings,
  baseUrl: string,
  apiKey: string,
  expected: ExpectedKeyConfig,
  identity: CallerIdentity
): Promise<boolean> => {
  const response = await fetchWithTimeout(
    {
      area: 'litellm.key.update',
      origin: 'litellm',
      method: 'POST',
      url: appendPath(baseUrl, '/key/update')
    },
    {
      method: 'POST',
      headers: managementHeaders(env),
      body: JSON.stringify({
        key: apiKey,
        key_alias: expected.keyAlias,
        user_id: expected.userId,
        models: expected.models,
        max_budget: expected.maxBudget,
        budget_duration: expected.budgetDuration,
        rpm_limit: expected.rpmLimit,
        tpm_limit: expected.tpmLimit,
        metadata: {
          app: 'tinytinkerer',
          github_id: identity.id,
          github_login: identity.login
        }
      })
    },
    10_000
  ).catch(() => undefined)

  return response?.ok === true
}

const generateKey = async (
  env: Bindings,
  baseUrl: string,
  apiKey: string,
  expected: ExpectedKeyConfig,
  identity: CallerIdentity
): Promise<boolean> => {
  const response = await fetchWithTimeout(
    {
      area: 'litellm.key.generate',
      origin: 'litellm',
      method: 'POST',
      url: appendPath(baseUrl, '/key/generate'),
      accept: {
        status: [400],
        reason:
          'Concurrent first-time per-user provisioning can race on the deterministic key alias; the edge re-reads by alias after a duplicate-alias response.'
      }
    },
    {
      method: 'POST',
      headers: managementHeaders(env),
      body: JSON.stringify({
        key: apiKey,
        key_type: 'llm_api',
        key_alias: expected.keyAlias,
        user_id: expected.userId,
        models: expected.models,
        spend: 0,
        max_budget: expected.maxBudget,
        budget_duration: expected.budgetDuration,
        rpm_limit: expected.rpmLimit,
        tpm_limit: expected.tpmLimit,
        metadata: {
          app: 'tinytinkerer',
          github_id: identity.id,
          github_login: identity.login
        }
      })
    },
    10_000
  ).catch(() => undefined)

  if (!response?.ok) return false
  const parsed = generateKeyResponseSchema.safeParse(
    await response.json().catch(() => undefined)
  )
  return parsed.success && parsed.data.key === apiKey
}

export const resolveLiteLLMUserKey = async (
  env: Bindings,
  baseUrl: string,
  identity: CallerIdentity
): Promise<LiteLLMUserKey | undefined> => {
  if (!managementConfigured(env)) return undefined

  const expected = expectedConfig(env, identity)
  const resolved = await Promise.all([
    deriveUserApiKey(env, baseUrl, identity),
    deriveCredentialKey(liteLLMUserCredentialKeyInput(identity, baseUrl))
  ]).catch(() => undefined)
  if (!resolved) return undefined
  const [apiKey, credentialKey] = resolved

  if (await readProvisionedMarker(credentialKey, expected.fingerprint)) {
    return {
      apiKey,
      keyAlias: expected.keyAlias,
      userId: expected.userId,
      credentialKey
    }
  }

  const existing = await readKeyInfoByAlias(env, baseUrl, expected.keyAlias)
  if (existing) {
    if (keyNeedsUpdate(existing, expected)) {
      const updated = await updateKey(env, baseUrl, apiKey, expected, identity)
      if (!updated) return undefined
    }
    await writeProvisionedMarker(credentialKey, expected.fingerprint)
    return {
      apiKey,
      keyAlias: expected.keyAlias,
      userId: expected.userId,
      credentialKey
    }
  }

  if (!(await generateKey(env, baseUrl, apiKey, expected, identity))) {
    const raced = await readKeyInfoByAlias(env, baseUrl, expected.keyAlias)
    if (!raced) return undefined
    if (keyNeedsUpdate(raced, expected)) {
      const updated = await updateKey(env, baseUrl, apiKey, expected, identity)
      if (!updated) return undefined
    }
  }

  await writeProvisionedMarker(credentialKey, expected.fingerprint)
  return {
    apiKey,
    keyAlias: expected.keyAlias,
    userId: expected.userId,
    credentialKey
  }
}
