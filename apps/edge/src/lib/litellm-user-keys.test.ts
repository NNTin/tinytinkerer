import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearLiteLLMUserKeyCache,
  liteLLMUserCredentialKeyInput,
  requireLiteLLMUserKeyConfiguration,
  resolveLiteLLMUserKey
} from './litellm-user-keys.js'
import type { Bindings } from './bindings.js'
import type { CallerIdentity } from './caller-validation.js'
import { makeCacheMock } from '../test/cache-mock.js'

const BASE_URL = 'https://litellm.labs.lair.nntin.xyz'
const IDENTITY: CallerIdentity = { id: '12345', login: 'nntin' }
const OTHER_IDENTITY: CallerIdentity = { id: '67890', login: 'other-user' }

const CONFIGURED_ENV: Bindings = {
  LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
  LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
}

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/**
 * Key-management fetch stub. `keyInfoForAttempt` lets a test return a different
 * `/v2/key/info` body per call (used by the generate-race path, which re-reads
 * by alias after a duplicate-alias 400).
 */
const keyManagementStub = (options: {
  keyInfoForAttempt?: (attempt: number) => Response
  generate?: (body: { key?: string }) => Response
  update?: () => Response
}) => {
  let infoAttempt = 0
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(toRequestUrl(input)).pathname
    if (path === '/v2/key/info') {
      infoAttempt += 1
      return Promise.resolve(
        options.keyInfoForAttempt?.(infoAttempt) ??
          jsonResponse({ info: [] })
      )
    }
    if (path === '/key/generate') {
      const rawBody = typeof init?.body === 'string' ? init.body : '{}'
      const body = JSON.parse(rawBody) as { key?: string }
      return Promise.resolve(
        options.generate?.(body) ?? jsonResponse({ key: body.key })
      )
    }
    if (path === '/key/update') {
      return Promise.resolve(options.update?.() ?? jsonResponse({ updated: true }))
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }))
  })
}

const generateBody = (fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const call = (
    fetchSpy.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
  ).find(([input]) => new URL(toRequestUrl(input)).pathname === '/key/generate')
  if (!call) throw new Error('expected a /key/generate call')
  const rawBody = call[1]?.body
  if (typeof rawBody !== 'string') throw new Error('expected a JSON body')
  return JSON.parse(rawBody) as Record<string, unknown>
}

describe('litellm-user-keys', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    void clearLiteLLMUserKeyCache()
  })

  it('reports configuration gaps and the credential-key input shape', () => {
    expect(requireLiteLLMUserKeyConfiguration({})).toBe(
      'LiteLLM user key provisioning is not configured.'
    )
    expect(
      requireLiteLLMUserKeyConfiguration({
        LITELLM_KEY_MANAGEMENT_API_KEY: 'k'
      })
    ).toBe('LiteLLM user key provisioning is not configured.')
    expect(requireLiteLLMUserKeyConfiguration(CONFIGURED_ENV)).toBeUndefined()

    // The credential-key input must fold in the base URL AND the GitHub id so
    // one user's backoff/key scope can never collide with another's or with the
    // same user on a different LiteLLM deployment.
    expect(liteLLMUserCredentialKeyInput(IDENTITY, BASE_URL)).toBe(
      `litellm-user:${BASE_URL}:github-12345`
    )
    expect(
      liteLLMUserCredentialKeyInput(OTHER_IDENTITY, BASE_URL)
    ).not.toBe(liteLLMUserCredentialKeyInput(IDENTITY, BASE_URL))
  })

  it('returns undefined without touching the network when provisioning is unconfigured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      resolveLiteLLMUserKey({}, BASE_URL, IDENTITY)
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('mints a per-user key carrying the configured budget on first use', async () => {
    const fetchSpy = keyManagementStub({})
    vi.stubGlobal('fetch', fetchSpy)

    const env: Bindings = {
      ...CONFIGURED_ENV,
      LITELLM_USER_MAX_BUDGET_USD: '5',
      LITELLM_USER_BUDGET_DURATION: '7d',
      LITELLM_USER_RPM_LIMIT: '20',
      LITELLM_USER_TPM_LIMIT: '250000',
      LITELLM_USER_MODELS: 'openai/gpt-5, openai/gpt-4.1-mini'
    }

    const key = await resolveLiteLLMUserKey(env, BASE_URL, IDENTITY)

    expect(key?.apiKey).toMatch(/^sk-tt-/)
    expect(key?.userId).toBe('github-12345')
    expect(key?.keyAlias).toBe('tinytinkerer-github-12345')

    // The minted key carries the per-user budget — this is the whole feature.
    const body = generateBody(fetchSpy)
    expect(body['key']).toBe(key?.apiKey)
    expect(body['user_id']).toBe('github-12345')
    expect(body['key_alias']).toBe('tinytinkerer-github-12345')
    expect(body['max_budget']).toBe(5)
    expect(body['budget_duration']).toBe('7d')
    expect(body['rpm_limit']).toBe(20)
    expect(body['tpm_limit']).toBe(250000)
    expect(body['spend']).toBe(0)
    expect(body['models']).toEqual(['openai/gpt-4.1-mini', 'openai/gpt-5'])
  })

  it('falls back to the documented budget defaults when no env overrides are set', async () => {
    const fetchSpy = keyManagementStub({})
    vi.stubGlobal('fetch', fetchSpy)

    await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)

    const body = generateBody(fetchSpy)
    expect(body['max_budget']).toBe(1)
    expect(body['budget_duration']).toBe('30d')
    expect(body['rpm_limit']).toBe(10)
    expect(body['tpm_limit']).toBe(100000)
  })

  it('derives a DISTINCT key, user_id and alias for each GitHub user (per-user isolation)', async () => {
    const fetchSpy = keyManagementStub({})
    vi.stubGlobal('fetch', fetchSpy)

    const first = await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)
    const second = await resolveLiteLLMUserKey(
      CONFIGURED_ENV,
      BASE_URL,
      OTHER_IDENTITY
    )

    expect(first?.apiKey).toBeDefined()
    expect(second?.apiKey).toBeDefined()
    // One user's minted key must never equal another's.
    expect(first?.apiKey).not.toBe(second?.apiKey)
    expect(first?.userId).not.toBe(second?.userId)
    expect(first?.keyAlias).not.toBe(second?.keyAlias)
    expect(first?.credentialKey).not.toBe(second?.credentialKey)
  })

  it('short-circuits on the in-memory provisioned marker without re-hitting the key plane', async () => {
    const fetchSpy = keyManagementStub({})
    vi.stubGlobal('fetch', fetchSpy)

    const first = await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)
    const callsAfterFirst = fetchSpy.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Second resolve for the same user + base URL + config fingerprint must be
    // served from the provisioned marker — no further /v2/key/info, /key/generate.
    const second = await resolveLiteLLMUserKey(
      CONFIGURED_ENV,
      BASE_URL,
      IDENTITY
    )
    expect(second?.apiKey).toBe(first?.apiKey)
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst)
  })

  it('reconciles an existing key whose budget has drifted from the configured value', async () => {
    const fetchSpy = keyManagementStub({
      keyInfoForAttempt: () =>
        jsonResponse({
          info: [
            {
              key_alias: 'tinytinkerer-github-12345',
              user_id: 'github-12345',
              // Operator changed the budget upstream: a concrete differing value
              // must trigger a /key/update, not silently keep the stale budget.
              max_budget: 999
            }
          ]
        })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const key = await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)

    expect(key?.apiKey).toMatch(/^sk-tt-/)
    const updateCalled = fetchSpy.mock.calls.some(
      ([input]) => new URL(toRequestUrl(input)).pathname === '/key/update'
    )
    expect(updateCalled).toBe(true)
    // No generate when the alias already exists.
    const generateCalled = fetchSpy.mock.calls.some(
      ([input]) => new URL(toRequestUrl(input)).pathname === '/key/generate'
    )
    expect(generateCalled).toBe(false)
  })

  it('recovers from a duplicate-alias generate race by re-reading the key by alias', async () => {
    const fetchSpy = keyManagementStub({
      // First /v2/key/info: nothing yet (cold). Second (after the racing 400):
      // the concurrent request already created the alias.
      keyInfoForAttempt: (attempt) =>
        attempt === 1
          ? jsonResponse({ info: [] })
          : jsonResponse({
              info: [
                {
                  key_alias: 'tinytinkerer-github-12345',
                  user_id: 'github-12345',
                  max_budget: 1,
                  budget_duration: '30d',
                  rpm_limit: 10,
                  tpm_limit: 100000
                }
              ]
            }),
      // The deterministic alias is already taken: LiteLLM 400s the generate.
      generate: () => new Response('duplicate alias', { status: 400 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const key = await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)

    // The race is recoverable: the edge re-reads the alias and serves the key
    // rather than surfacing a provisioning failure.
    expect(key?.apiKey).toMatch(/^sk-tt-/)
    expect(key?.keyAlias).toBe('tinytinkerer-github-12345')
  })

  it('returns undefined when minting fails and no key exists to fall back to', async () => {
    const fetchSpy = keyManagementStub({
      keyInfoForAttempt: () => jsonResponse({ info: [] }),
      // Generate fails for a real reason (e.g. management key lacks permission)
      // and the post-failure alias re-read still finds nothing.
      generate: () => new Response('forbidden', { status: 403 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)
    ).resolves.toBeUndefined()
  })

  it('clearLiteLLMUserKeyCache drops the durable marker so the next resolve re-provisions', async () => {
    const { store, cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = keyManagementStub({})
    vi.stubGlobal('fetch', fetchSpy)

    await resolveLiteLLMUserKey(CONFIGURED_ENV, BASE_URL, IDENTITY)
    // A durable provisioned marker was written.
    expect(store.size).toBeGreaterThan(0)

    await clearLiteLLMUserKeyCache()
    expect(store.size).toBe(0)
  })
})
