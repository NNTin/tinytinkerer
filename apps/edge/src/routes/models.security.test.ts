import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index.js'
import {
  clearLiteLLMUserKeyCache,
  deriveLiteLLMUserCredentialKey,
  resolveLiteLLMUserKey
} from '../lib/litellm-user-keys.js'
import { clearCallerValidationCache } from '../lib/caller-validation-cache.js'
import { clearModelsBackoff } from '../lib/rate-limit.js'

// Security-focused coverage for the per-user LiteLLM budget feature. Kept in a
// dedicated *.security.test.ts so it does not collide with the parallel
// correctness/test rewrite of index.test.ts.

const IDENTITY = { id: '12345', login: 'nntin' }
const BASE_URL = 'https://litellm.labs.lair.nntin.xyz'
const GITHUB_USER_URL = 'https://api.github.com/user'

const envFor = (secret: string) => ({
  LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
  LITELLM_USER_KEY_SECRET: secret,
  LITELLM_BASE_URL: `${BASE_URL}/`
})

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined]

/** Stub that answers the key-management endpoints and records what was sent. */
const keyManagementStub = () => {
  const calls: FetchCall[] = []
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init])
    const path = new URL(toRequestUrl(input)).pathname
    if (path === '/v2/key/info') {
      return Promise.resolve(
        new Response(JSON.stringify({ key: [], info: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    }
    if (path === '/key/generate') {
      const rawBody = typeof init?.body === 'string' ? init.body : '{}'
      const body = JSON.parse(rawBody) as { key?: string }
      return Promise.resolve(
        new Response(JSON.stringify({ key: body.key ?? 'sk-tt-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
  return { spy, calls }
}

const generatedAlias = (calls: FetchCall[]): string | undefined => {
  const generate = calls.find(
    ([input]) => new URL(toRequestUrl(input)).pathname === '/key/generate'
  )
  if (!generate) return undefined
  const raw = typeof generate[1]?.body === 'string' ? generate[1].body : '{}'
  return (JSON.parse(raw) as { key_alias?: string }).key_alias
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearModelsBackoff()
  clearCallerValidationCache()
  void clearLiteLLMUserKeyCache()
})

describe('per-user LiteLLM key — deployment isolation', () => {
  it('namespaces the minted key alias by the key-minting secret', async () => {
    const a = keyManagementStub()
    vi.stubGlobal('fetch', a.spy)
    await resolveLiteLLMUserKey(envFor('secret-A'), BASE_URL, IDENTITY)
    const aliasA = generatedAlias(a.calls)

    void clearLiteLLMUserKeyCache()
    vi.unstubAllGlobals()

    const b = keyManagementStub()
    vi.stubGlobal('fetch', b.spy)
    await resolveLiteLLMUserKey(envFor('secret-B'), BASE_URL, IDENTITY)
    const aliasB = generatedAlias(b.calls)

    expect(aliasA).toMatch(/^tinytinkerer-[0-9a-f]{12}-github-12345$/)
    expect(aliasB).toMatch(/^tinytinkerer-[0-9a-f]{12}-github-12345$/)
    // Two deployments that share a LiteLLM backend but hold different secrets
    // must NOT collide on the deterministic alias.
    expect(aliasA).not.toBe(aliasB)
  })

  it('mints the same alias for the same secret (stable, idempotent)', async () => {
    const a = keyManagementStub()
    vi.stubGlobal('fetch', a.spy)
    await resolveLiteLLMUserKey(envFor('secret-A'), BASE_URL, IDENTITY)
    const first = generatedAlias(a.calls)

    void clearLiteLLMUserKeyCache()
    vi.unstubAllGlobals()

    const b = keyManagementStub()
    vi.stubGlobal('fetch', b.spy)
    await resolveLiteLLMUserKey(envFor('secret-A'), BASE_URL, IDENTITY)
    const second = generatedAlias(b.calls)

    expect(first).toBe(second)
  })

  it('derives disjoint backoff/marker scopes per deployment secret', async () => {
    const keyA = await deriveLiteLLMUserCredentialKey(envFor('secret-A'), IDENTITY, BASE_URL)
    const keyA2 = await deriveLiteLLMUserCredentialKey(envFor('secret-A'), IDENTITY, BASE_URL)
    const keyB = await deriveLiteLLMUserCredentialKey(envFor('secret-B'), IDENTITY, BASE_URL)
    expect(keyA).toBe(keyA2)
    expect(keyA).not.toBe(keyB)
  })
})

describe('per-user LiteLLM key — no secret leakage in error bodies', () => {
  it('redacts a virtual key echoed in an upstream 400 chat error', async () => {
    const leakedKey = 'sk-tt-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead'
    const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 12345, login: 'nntin' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      const path = new URL(url).pathname
      if (path === '/v2/key/info' || path === '/key/generate') {
        const rawBody = typeof init?.body === 'string' ? init.body : '{}'
        if (path === '/v2/key/info') {
          return Promise.resolve(
            new Response(JSON.stringify({ key: [], info: [] }), { status: 200 })
          )
        }
        const body = JSON.parse(rawBody) as { key?: string }
        return Promise.resolve(
          new Response(JSON.stringify({ key: body.key ?? 'sk-tt-test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      // The chat completion echoes the presented bearer in its error body, as
      // some LiteLLM error formats do.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: `Authentication error. Received Key=${leakedKey} for model gpt-4o`
            }
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      )
    })
    vi.stubGlobal('fetch', spy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'hi' }]
        })
      }),
      envFor('litellm-user-key-secret')
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).not.toContain(leakedKey)
    expect(body.error).toContain('sk-[redacted]')
  })
})
