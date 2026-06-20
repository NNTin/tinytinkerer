import { z } from 'zod'
import { captureTelemetryMessage } from '@tinytinkerer/sentry-telemetry'
import type { Bindings } from './bindings'
import type { CallerIdentity } from './caller-validation'
import { fetchWithTimeout } from './fetch'
import { deriveCredentialKey, type CredentialKey } from './rate-limit'

const DEFAULT_USER_MAX_BUDGET_USD = 1
const DEFAULT_USER_BUDGET_DURATION = '30d'
const DEFAULT_USER_RPM_LIMIT = 10
const DEFAULT_USER_TPM_LIMIT = 100_000
const DEFAULT_ANONYMOUS_MAX_BUDGET_USD = 0.1
const DEFAULT_ANONYMOUS_BUDGET_DURATION = '30d'
const DEFAULT_ANONYMOUS_RPM_LIMIT = 3
const DEFAULT_ANONYMOUS_TPM_LIMIT = 20_000
const PROVISIONED_TTL_MS = 10 * 60_000
// Do not use LiteLLM's key_type: 'llm_api' shortcut here: that handler
// overwrites allowed_routes to only llm_api_routes, which blocks /model/info.
const EXPECTED_ALLOWED_ROUTES = ['llm_api_routes', 'info_routes'] as const

export const ANONYMOUS_IDENTITY: CallerIdentity = { id: 'anonymous', login: 'anonymous' }

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
        models: z.array(z.string()).nullable().optional(),
        allowed_routes: z.array(z.string()).nullable().optional()
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
  allowedRoutes: string[]
  fingerprint: string
}

type KeyInfo = z.infer<typeof keyInfoResponseSchema>['info'][number]

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const provisionedUntilByScope = new Map<string, number>()

export const clearLiteLLMUserKeyCache = async (credentialKey?: CredentialKey): Promise<void> => {
  // Drop BOTH layers. Clearing only the in-memory mirror is a no-op for
  // recovery: readProvisionedMarker falls back to the durable Workers Cache
  // entry and re-populates the mirror, so a key invalidated upstream (deleted,
  // or LITELLM_USER_KEY_SECRET rotated) would keep short-circuiting past
  // re-provisioning until the durable marker's TTL elapses. The credential key
  // is a colon-free hash, so the scope splits on the first ':' into
  // credentialKey + fingerprint — exactly the inputs the durable cache key
  // needs.
  const store = cacheStore()
  const deletions: Promise<unknown>[] = []
  for (const scope of [...provisionedUntilByScope.keys()]) {
    const separator = scope.indexOf(':')
    const scopeCredential = scope.slice(0, separator)
    if (credentialKey && scopeCredential !== credentialKey) continue
    provisionedUntilByScope.delete(scope)
    if (store) {
      const fingerprint = scope.slice(separator + 1)
      deletions.push(
        store.delete(provisionedCacheKey(scopeCredential, fingerprint)).catch(() => undefined)
      )
    }
  }
  await Promise.all(deletions)
}

const provisionedCacheKey = (credentialKey: CredentialKey, fingerprint: string): string =>
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

// The two key tiers this module provisions. They differ ONLY in: which env vars
// supply the budget/rate limits (and their defaults), and how the LiteLLM
// identity (user_id / key_alias) is derived. Everything else — the
// read-marker → read-by-alias → update/generate → write-marker state machine — is
// identical, so it lives in one resolveLiteLLMKey (below) parameterized by tier.
type KeyTier = 'user' | 'anonymous'

// Budget/rate limits for a tier, read from the tier's own env vars with the
// tier's defaults. Kept as one switch so a new limit is added in a single place
// for both tiers.
const tierLimits = (
  env: Bindings,
  tier: KeyTier
): Pick<ExpectedKeyConfig, 'maxBudget' | 'budgetDuration' | 'rpmLimit' | 'tpmLimit'> =>
  tier === 'anonymous'
    ? {
        maxBudget: toPositiveNumber(
          env.LITELLM_ANONYMOUS_MAX_BUDGET_USD,
          DEFAULT_ANONYMOUS_MAX_BUDGET_USD
        ),
        budgetDuration:
          env.LITELLM_ANONYMOUS_BUDGET_DURATION?.trim() || DEFAULT_ANONYMOUS_BUDGET_DURATION,
        rpmLimit: toPositiveNumber(env.LITELLM_ANONYMOUS_RPM_LIMIT, DEFAULT_ANONYMOUS_RPM_LIMIT),
        tpmLimit: toPositiveNumber(env.LITELLM_ANONYMOUS_TPM_LIMIT, DEFAULT_ANONYMOUS_TPM_LIMIT)
      }
    : {
        maxBudget: toPositiveNumber(env.LITELLM_USER_MAX_BUDGET_USD, DEFAULT_USER_MAX_BUDGET_USD),
        budgetDuration: env.LITELLM_USER_BUDGET_DURATION?.trim() || DEFAULT_USER_BUDGET_DURATION,
        rpmLimit: toPositiveNumber(env.LITELLM_USER_RPM_LIMIT, DEFAULT_USER_RPM_LIMIT),
        tpmLimit: toPositiveNumber(env.LITELLM_USER_TPM_LIMIT, DEFAULT_USER_TPM_LIMIT)
      }

// The LiteLLM user_id and key_alias for a tier. The anonymous tier uses a fixed
// identity regardless of the (ANONYMOUS_IDENTITY) caller; the user tier keys off
// the GitHub id. The alias carries the per-deployment namespace (see
// deploymentKeyNamespace).
const tierIdentity = (
  tier: KeyTier,
  identity: CallerIdentity,
  namespace: string
): Pick<ExpectedKeyConfig, 'userId' | 'keyAlias'> =>
  tier === 'anonymous'
    ? { userId: 'anonymous', keyAlias: `tinytinkerer-${namespace}-anonymous` }
    : {
        userId: `github-${identity.id}`,
        keyAlias: `tinytinkerer-${namespace}-github-${identity.id}`
      }

const expectedConfig = (
  env: Bindings,
  identity: CallerIdentity,
  namespace: string,
  tier: KeyTier
): ExpectedKeyConfig => {
  const models = configuredModels(env).sort()
  const allowedRoutes = [...EXPECTED_ALLOWED_ROUTES]
  const limits = tierLimits(env, tier)
  const { userId, keyAlias } = tierIdentity(tier, identity, namespace)
  // Field order here is load-bearing: the fingerprint is the durable
  // provisioning marker's scope. The original budget/model fields stay first;
  // allowedRoutes is intentionally appended so deployments refresh keys that
  // were minted before /model/info access was required for context gauges.
  const fingerprint = JSON.stringify({
    maxBudget: limits.maxBudget,
    budgetDuration: limits.budgetDuration,
    rpmLimit: limits.rpmLimit,
    tpmLimit: limits.tpmLimit,
    models,
    allowedRoutes
  })

  return {
    keyAlias,
    userId,
    ...limits,
    models,
    allowedRoutes,
    fingerprint
  }
}

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

// Per-deployment namespace derived from the key-minting secret. The reconcile
// path trusts "alias exists ⇒ its value equals our derived key", and the key
// VALUE already depends on LITELLM_USER_KEY_SECRET (see deriveUserApiKey). When
// two deployments share ONE LiteLLM backend — exactly the wrangler.jsonc setup,
// where production AND develop (which also backs every PR preview) both point
// LITELLM_BASE_URL at the same upstream — but hold DIFFERENT secrets, an
// un-namespaced alias (`tinytinkerer-github-<id>`) collides: the second
// deployment finds the FIRST deployment's key by alias, assumes its value
// matches (info never returns the secret value), and hands LiteLLM a bearer that
// does not exist there — a silent, persistent 401 that regenerate can't recover
// from (the alias is already taken). If instead the secret is SHARED across
// those deployments, the collision silently merges their budgets, so the preview
// edge spends production's per-user budget. Namespacing the alias (and the
// durable provisioning/backoff scope) by a non-reversible digest of the secret
// makes the alias as specific as the value: each deployment owns a disjoint
// alias space, restoring the per-deployment isolation this module relies on.
const deploymentKeyNamespace = async (secret: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tinytinkerer-litellm-deployment:v1:${secret}`)
  )
  return bytesToHex(new Uint8Array(digest)).slice(0, 12)
}

// The derived key value must depend on EXACTLY the same inputs as the LiteLLM
// identity it is stored under (key_alias / user_id = `...-github-<id>`), i.e.
// the GitHub id alone — not the base URL. The reconcile path can only look the
// key up by alias (/v2/key/info never returns the secret value), so it trusts
// "alias exists ⇒ its value equals our derived key". Mixing the base URL into
// the HMAC but not the alias broke that invariant: two allowed base URLs that
// resolve to the same LiteLLM backend would share one alias yet derive two key
// values, and the second would send a bearer token that does not exist in
// LiteLLM (a silent, unrecoverable 401). Per-deployment isolation already comes
// from the per-deployment LITELLM_USER_KEY_SECRET.
const deriveUserApiKey = async (env: Bindings, identity: CallerIdentity): Promise<string> => {
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
    new TextEncoder().encode(`tinytinkerer-litellm-user-key:v1:${identity.id}`)
  )
  return `sk-tt-${bytesToHex(new Uint8Array(signature)).slice(0, 48)}`
}

// Durable per-user scope for the backoff window AND the provisioning marker.
// Includes the same per-deployment namespace as the key alias: the Workers Cache
// the marker lives in is keyed by URL within the zone and can be shared by two
// deployments on the same backend, so an un-namespaced scope would let one
// deployment read the other's "already provisioned" marker and short-circuit
// past minting its OWN (disjoint-alias) key — handing LiteLLM a non-existent
// bearer. deriveCredentialKey hashes the whole input, so the secret-derived
// namespace never lands anywhere reversible.
export const deriveLiteLLMUserCredentialKey = async (
  env: Bindings,
  identity: CallerIdentity,
  baseUrl: string
): Promise<CredentialKey> => {
  const secret = env.LITELLM_USER_KEY_SECRET?.trim()
  const namespace = secret ? await deploymentKeyNamespace(secret) : 'unconfigured'
  return deriveCredentialKey(`litellm-user:${namespace}:${baseUrl}:github-${identity.id}`)
}

export const deriveAnonymousCredentialKey = async (
  env: Bindings,
  baseUrl: string
): Promise<CredentialKey> => {
  const secret = env.LITELLM_USER_KEY_SECRET?.trim()
  const namespace = secret ? await deploymentKeyNamespace(secret) : 'unconfigured'
  return deriveCredentialKey(`litellm-anonymous:${namespace}:${baseUrl}`)
}

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

export const requireLiteLLMUserKeyConfiguration = (env: Bindings): string | undefined =>
  managementConfigured(env) ? undefined : 'LiteLLM user key provisioning is not configured.'

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
        reason: 'A missing per-user LiteLLM key is expected before first-time provisioning.'
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
  const parsed = keyInfoResponseSchema.safeParse(await response.json().catch(() => undefined))
  if (!parsed.success) return undefined
  return parsed.data.info.find((entry) => entry.key_alias === keyAlias)
}

// Reconcile only on a CONCRETE differing value. We set every field at generate
// (and again at update) time, but LiteLLM does not necessarily echo them back
// verbatim on /v2/key/info — e.g. it may report budget_duration as null while
// tracking budget_reset_at, or rewrite an empty `models` to its own
// "all models" sentinel. Treating a null/absent field as "drifted" would fire a
// redundant /key/update on every cache-miss forever; treating it as "matches"
// still catches real operator-driven config changes, which surface as a
// concrete value that differs.
const keyNeedsUpdate = (info: KeyInfo, expected: ExpectedKeyConfig): boolean => {
  if (info.user_id != null && info.user_id !== expected.userId) return true
  if (info.max_budget != null && info.max_budget !== expected.maxBudget) return true
  if (info.budget_duration != null && info.budget_duration !== expected.budgetDuration) return true
  if (info.rpm_limit != null && info.rpm_limit !== expected.rpmLimit) return true
  if (info.tpm_limit != null && info.tpm_limit !== expected.tpmLimit) return true
  if (info.models != null && !arraysEqual([...info.models].sort(), expected.models)) return true
  if (
    info.allowed_routes != null &&
    !arraysEqual([...info.allowed_routes].sort(), [...expected.allowedRoutes].sort())
  ) {
    return true
  }
  return false
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
        allowed_routes: expected.allowedRoutes,
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

// Generate has three distinct outcomes that the caller must NOT collapse:
//   'created'      — LiteLLM accepted the request and echoed back OUR
//                    deterministic key value; the alias's value provably matches.
//   'value-mismatch' — LiteLLM accepted the request but minted a DIFFERENT key
//                    value (it ignored the supplied `key`). Our derived bearer
//                    will never authenticate, and the alias is now taken so
//                    regenerate can't recover — the route would otherwise hand
//                    LiteLLM a non-existent bearer and 401 silently forever. This
//                    is a hard, surfaced failure, NOT a recoverable race.
//   'unconfirmed'  — non-ok (e.g. a 400 duplicate-alias race) or an unparseable
//                    body; the caller re-reads by alias to recover from a
//                    concurrent first-time provision.
type GenerateKeyOutcome = 'created' | 'value-mismatch' | 'unconfirmed'

const generateKey = async (
  env: Bindings,
  baseUrl: string,
  apiKey: string,
  expected: ExpectedKeyConfig,
  identity: CallerIdentity
): Promise<GenerateKeyOutcome> => {
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
        key_alias: expected.keyAlias,
        user_id: expected.userId,
        models: expected.models,
        allowed_routes: expected.allowedRoutes,
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

  if (!response?.ok) return 'unconfirmed'
  const parsed = generateKeyResponseSchema.safeParse(await response.json().catch(() => undefined))
  if (!parsed.success) return 'unconfirmed'
  return parsed.data.key === apiKey ? 'created' : 'value-mismatch'
}

// Surfaces a key-value mismatch (LiteLLM minted a different value than our
// deterministic key) to telemetry. The wording, the github_id tag, and the
// fingerprint differ by tier; the key VALUE is never logged — only the
// user/alias it was provisioned for.
const reportKeyValueMismatch = (
  tier: KeyTier,
  identity: CallerIdentity,
  keyAlias: string
): void => {
  const isUser = tier === 'user'
  captureTelemetryMessage(
    isUser
      ? 'LiteLLM /key/generate returned a key value that does not match the deterministic per-user key; provisioning aborted'
      : 'LiteLLM /key/generate returned a key value that does not match the deterministic anonymous key; provisioning aborted',
    {
      level: 'error',
      tags: {
        request_area: 'litellm.key.generate',
        request_origin: 'litellm',
        failure_kind: 'key_value_mismatch',
        ...(isUser ? { github_id: identity.id } : {}),
        key_alias: keyAlias
      },
      fingerprint: [
        isUser ? 'litellm-user-key-value-mismatch' : 'litellm-anonymous-key-value-mismatch'
      ]
    }
  )
}

// The shared provisioning state machine for both key tiers: short-circuit on the
// durable provisioning marker, else read the key by alias (reconciling config
// drift via /key/update), else generate it — re-reading by alias to recover from
// a concurrent first-time provision, and failing hard on a value mismatch. The
// ONLY per-tier inputs are the expected config (env vars / identity) and the
// credential key derivation; everything else is identical, so the two former
// near-duplicate functions are now thin wrappers around this.
const resolveLiteLLMKey = async (
  env: Bindings,
  baseUrl: string,
  identity: CallerIdentity,
  tier: KeyTier
): Promise<LiteLLMUserKey | undefined> => {
  if (!managementConfigured(env)) return undefined

  const secret = env.LITELLM_USER_KEY_SECRET?.trim()
  if (!secret) return undefined
  const namespace = await deploymentKeyNamespace(secret).catch(() => undefined)
  if (!namespace) return undefined

  const expected = expectedConfig(env, identity, namespace, tier)
  const resolved = await Promise.all([
    deriveUserApiKey(env, identity),
    tier === 'anonymous'
      ? deriveAnonymousCredentialKey(env, baseUrl)
      : deriveLiteLLMUserCredentialKey(env, identity, baseUrl)
  ]).catch(() => undefined)
  if (!resolved) return undefined
  const [apiKey, credentialKey] = resolved

  const result: LiteLLMUserKey = {
    apiKey,
    keyAlias: expected.keyAlias,
    userId: expected.userId,
    credentialKey
  }

  if (await readProvisionedMarker(credentialKey, expected.fingerprint)) {
    return result
  }

  const existing = await readKeyInfoByAlias(env, baseUrl, expected.keyAlias)
  if (existing) {
    if (keyNeedsUpdate(existing, expected)) {
      const updated = await updateKey(env, baseUrl, apiKey, expected, identity)
      if (!updated) return undefined
    }
    await writeProvisionedMarker(credentialKey, expected.fingerprint)
    return result
  }

  const generated = await generateKey(env, baseUrl, apiKey, expected, identity)
  if (generated === 'value-mismatch') {
    // LiteLLM did not honour our deterministic key value. Re-reading by alias
    // here would find the just-created key and wrongly trust "alias exists ⇒
    // value matches", so the route would hand LiteLLM a bearer it never stored
    // and 401 on every call until the marker expires. Fail hard and SURFACE it
    // so the misconfiguration is visible instead of a silent auth loop.
    reportKeyValueMismatch(tier, identity, expected.keyAlias)
    return undefined
  }
  if (generated === 'unconfirmed') {
    const raced = await readKeyInfoByAlias(env, baseUrl, expected.keyAlias)
    if (!raced) return undefined
    if (keyNeedsUpdate(raced, expected)) {
      const updated = await updateKey(env, baseUrl, apiKey, expected, identity)
      if (!updated) return undefined
    }
  }

  await writeProvisionedMarker(credentialKey, expected.fingerprint)
  return result
}

export const resolveLiteLLMUserKey = (
  env: Bindings,
  baseUrl: string,
  identity: CallerIdentity
): Promise<LiteLLMUserKey | undefined> => resolveLiteLLMKey(env, baseUrl, identity, 'user')

export const resolveAnonymousLiteLLMKey = (
  env: Bindings,
  baseUrl: string
): Promise<LiteLLMUserKey | undefined> =>
  resolveLiteLLMKey(env, baseUrl, ANONYMOUS_IDENTITY, 'anonymous')
