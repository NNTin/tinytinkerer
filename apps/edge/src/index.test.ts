import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  edgeErrorResponseSchema,
  rateLimitPayloadSchema,
  systemStatusSchema
} from '@tinytinkerer/contracts'
import {
  setCaptureExceptionSink,
  setCaptureMessageSink,
  type CaptureExceptionSink,
  type CaptureMessageSink
} from '@tinytinkerer/sentry-telemetry'
import app from './index.js'
import { cacheKeyForScope } from './lib/models-cache.js'
import { clearCallerValidationCache } from './lib/caller-validation-cache.js'
import { clearInboundRateLimits } from './lib/inbound-rate-limit.js'
import { clearLiteLLMUserKeyCache } from './lib/litellm-user-keys.js'
import { clearModelsBackoff } from './lib/rate-limit.js'
import { makeCacheMock } from './test/cache-mock.js'

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

// Every models route validates the caller's GitHub identity before resolving a
// per-user LiteLLM virtual key, so model tests need both the env and a mocked
// api.github.com/user probe. LITELLM_BASE_URL is required too: there is no
// code-level fallback (issue #179).
const LITELLM_ENV = {
  LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
  LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret',
  LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/'
}
const GITHUB_USER_URL = 'https://api.github.com/user'
const githubUserOk = () =>
  new Response(JSON.stringify({ id: 12345, login: 'nntin' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

const isLiteLLMKeyManagementUrl = (url: string): boolean => {
  const path = new URL(url).pathname
  return (
    path === '/v2/key/info' ||
    path === '/key/generate' ||
    path === '/key/update'
  )
}

const litellmKeyManagementOk = (
  input: RequestInfo | URL,
  init?: RequestInit
): Response => {
  const path = new URL(toRequestUrl(input)).pathname
  if (path === '/v2/key/info') {
    return new Response(JSON.stringify({ key: [], info: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  if (path === '/key/generate') {
    const rawBody = typeof init?.body === 'string' ? init.body : '{}'
    const body = JSON.parse(rawBody) as { key?: string }
    return new Response(JSON.stringify({ key: body.key ?? 'sk-tt-test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return new Response(JSON.stringify({ updated: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/** Fetch stub that answers the caller-validation probe and delegates the rest. */
const withCallerValidation = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = toRequestUrl(input)
    if (url === GITHUB_USER_URL) {
      return Promise.resolve(githubUserOk())
    }
    if (isLiteLLMKeyManagementUrl(url)) {
      return Promise.resolve(litellmKeyManagementOk(input, init))
    }
    return handler(input, init)
  })

/** Data-plane upstream fetches excluding caller-validation and LiteLLM key management. */
const upstreamCalls = (
  fetchSpy: ReturnType<typeof vi.fn>
): Array<[RequestInfo | URL, RequestInit | undefined]> =>
  (
    fetchSpy.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
  ).filter(([input]) => {
    const url = toRequestUrl(input)
    return url !== GITHUB_USER_URL && !isLiteLLMKeyManagementUrl(url)
  })

/** Calls to the api.github.com/user caller-validation probe only. */
const githubProbeCalls = (
  fetchSpy: ReturnType<typeof vi.fn>
): Array<[RequestInfo | URL, RequestInit | undefined]> =>
  (
    fetchSpy.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
  ).filter(([input]) => toRequestUrl(input) === GITHUB_USER_URL)

const DEFAULT_LITELLM_SCOPE = encodeURIComponent(
  'https://litellm.labs.lair.nntin.xyz'
)

describe('edge routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    // The LiteLLM backoff window is module-level (per-isolate); reset it so
    // a 429 in one test doesn't short-circuit the next.
    clearModelsBackoff()
    // Likewise the caller-validation cache: a token validated in one test must
    // not skip the GitHub probe in the next.
    clearCallerValidationCache()
    // And the inbound rate-limit windows, so repeated search calls across tests
    // never trip the per-credential budget.
    clearInboundRateLimits()
    // Per-user LiteLLM provisioning markers are module-level too. The durable
    // purge is async, but the in-memory reset this teardown relies on happens
    // synchronously, so the returned promise can be left to settle on its own.
    void clearLiteLLMUserKeyCache()
    // Drop any telemetry sink a test registered so captures don't leak across.
    setCaptureExceptionSink(null)
    setCaptureMessageSink(null)
  })

  it('returns 401 when search is called without authorization', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      {}
    )

    expect(response.status).toBe(401)
    const body = edgeErrorResponseSchema.parse(await response.json())
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns a typed 503 error when search is unavailable', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      {}
    )

    expect(response.status).toBe(503)
    const body = edgeErrorResponseSchema.parse(await response.json())
    expect(body).toEqual({
      error:
        'Web search is currently unavailable. Configure Tavily to enable live search.'
    })
  })

  it('returns 401 for an invalid caller before spending the Tavily key', async () => {
    // GitHub rejects the token → invalid caller. The Tavily search must never run.
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer bad-token'
        },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      { TAVILY_API_KEY: 'tavily-shared-key' }
    )

    expect(response.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Unauthorized'
    })
    // Only the GitHub probe ran — the Tavily endpoint was never called.
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
  })

  it('returns 503 when search caller validation is unavailable', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response('github unavailable', { status: 503 })
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      { TAVILY_API_KEY: 'tavily-shared-key' }
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Caller validation is temporarily unavailable.'
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  it('proxies the Tavily search once the caller is validated', async () => {
    const fetchSpy = withCallerValidation((input) => {
      expect(toRequestUrl(input)).toBe('https://api.tavily.com/search')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'AI news',
                url: 'https://example.com/ai',
                content: 'Lots happened.'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      { TAVILY_API_KEY: 'tavily-shared-key' }
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      results: Array<{ url: string }>
    }
    expect(body.results[0]?.url).toBe('https://example.com/ai')
    // The caller was validated (one probe) before the Tavily key was used.
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('returns 429 with Retry-After header and rate-limit body when upstream is rate limited', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    const [chatCall] = upstreamCalls(fetchSpy)
    expect(chatCall?.[0]).toBe(
      'https://litellm.labs.lair.nntin.xyz/v1/chat/completions'
    )
    const headers = new Headers(chatCall?.[1]?.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer sk-tt-/)
    const body = (await response.json()) as Record<string, unknown>
    rateLimitPayloadSchema.parse(body)
    expect(body['code']).toBe('rate_limited')
    expect(body['error']).toBe('LiteLLM rate limit reached')
    expect(body['retryAfterMs']).toBe(120_000)
  })

  it('rejects the removed github/openrouter providers with a validation error', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    for (const provider of ['github', 'openrouter']) {
      const response = await app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-token'
          },
          body: JSON.stringify({
            provider,
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

      expect(response.status).toBe(400)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // A missing LITELLM_BASE_URL is "not configured"; missing per-user key
  // provisioning secrets are a distinct deployment error.
  it.each([
    ['nothing is set', {}, 'LiteLLM is not configured.'],
    [
      'the base URL is missing',
      {
        LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
        LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
      },
      'LiteLLM is not configured.'
    ],
    [
      'the key-management key is missing',
      {
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
      },
      'LiteLLM user key provisioning is not configured.'
    ],
    [
      'the user key secret is missing',
      {
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key'
      },
      'LiteLLM user key provisioning is not configured.'
    ]
  ])(
    'returns 503 when LiteLLM is not configured (%s)',
    async (_label, env, error) => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const response = await app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        env
      )

      expect(response.status).toBe(503)
      expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
        error
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  // Both models routes duplicate the same guard sequence; pin the missing-
  // Anonymous users (no authorization) should be allowed. They get provisioned
  // with the anonymous LiteLLM key, and may fail if key provisioning is
  // unavailable (503 instead of 401).
  it('allows anonymous access to the models routes', async () => {
    const fetchSpy = vi.fn((url: string) => {
      if (url.includes('/v2/key/info')) {
        return new Response(JSON.stringify({ info: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.includes('/key/generate')) {
        return new Response(JSON.stringify({ key: 'sk-tt-' + 'a'.repeat(48) }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const chatResponse = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'litellm',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )
    // Anonymous users are now allowed; they fail on the LiteLLM fetch (the mock
    // doesn't handle chat completions), not on auth.
    expect(chatResponse.status).not.toBe(401)

    const listResponse = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm'),
      LITELLM_ENV
    )
    // Anonymous users are now allowed; they succeed if key provisioning works.
    expect(listResponse.status).not.toBe(401)
    // The fetch spy should have been called for key provisioning.
    expect(fetchSpy).toHaveBeenCalled()
  })

  // Mirror of the chat-route unconfigured cases above: the list route runs the
  // same configuration guard.
  it.each([
    ['nothing is set', {}, 'LiteLLM is not configured.'],
    [
      'the base URL is missing',
      {
        LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
        LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
      },
      'LiteLLM is not configured.'
    ],
    [
      'the key-management key is missing',
      {
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
      },
      'LiteLLM user key provisioning is not configured.'
    ],
    [
      'the user key secret is missing',
      {
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key'
      },
      'LiteLLM user key provisioning is not configured.'
    ]
  ])(
    'returns 503 on models/list when LiteLLM is not configured (%s)',
    async (_label, env, error) => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const response = await app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        env
      )

      expect(response.status).toBe(503)
      expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
        error
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  it('health reports models degraded under the same rule the models routes 503 on, including base-URL validity', async () => {
    const healthStatus = async (env: Record<string, string>) => {
      const response = await app.fetch(
        new Request('http://localhost/health'),
        env
      )
      return systemStatusSchema.parse(await response.json()).models
    }

    expect((await healthStatus(LITELLM_ENV)).state).toBe('ready')
    // Present but INVALID base URL (http, credentials, query): the models
    // routes reject it via normalizeLiteLLMBaseUrl and answer 503, so /health
    // must not claim ready for the same env value.
    for (const badUrl of [
      'http://litellm.example.com/',
      'https://user:pw@litellm.example.com/',
      'https://litellm.example.com/?key=1'
    ]) {
      const models = await healthStatus({
        LITELLM_BASE_URL: badUrl,
        LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
        LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret'
      })
      expect(models.state).toBe('degraded')
      expect(models.detail).toBe('LiteLLM is not configured.')
    }
  })

  it('applies the default model when the request omits one', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(200)
    const [chatCall] = upstreamCalls(fetchSpy)
    const upstreamBody = chatCall?.[1]?.body
    if (typeof upstreamBody !== 'string') {
      throw new Error('Expected LiteLLM request body to be a JSON string')
    }
    expect((JSON.parse(upstreamBody) as { model: string }).model).toBe(
      'chatgpt/gpt-5.4'
    )
  })

  it('surfaces a missing provider field as a telemetry message instead of silently defaulting to litellm', async () => {
    const messageSink = vi.fn<CaptureMessageSink>()
    setCaptureMessageSink(messageSink)
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        // No `provider` field → the route serves LiteLLM (the sole provider),
        // which would otherwise hide a misbehaving client.
        body: JSON.stringify({
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    // The request still succeeds (litellm default), but the omission is reported.
    expect(response.status).toBe(200)
    const missingProviderReport = messageSink.mock.calls.find(
      ([, options]) =>
        options.tags?.['request_area'] === 'models.chat' &&
        options.tags?.['provider_missing'] === true
    )
    expect(missingProviderReport).toBeDefined()
    expect(missingProviderReport?.[1].tags?.['request_provider']).toBe('absent')
    expect(missingProviderReport?.[1].tags?.['resolved_provider']).toBe(
      'litellm'
    )
    expect(missingProviderReport?.[1].level).toBe('warning')
  })

  it('serves a graceful 503 (not a 502, not a raw 429) on a cold-cache-miss models/list rate limit, and does not capture the window-opener (TINYTINKERER-EDGE-5)', async () => {
    // No cache stub → cold isolate with an empty Cache API: the upstream fetch is
    // the unavoidable cold-cache-miss window-opener.
    const sink = vi.fn<CaptureExceptionSink>()
    setCaptureExceptionSink(sink)
    vi.stubGlobal(
      'fetch',
      withCallerValidation(() =>
        Promise.resolve(
          new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '90' }
          })
        )
      )
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer test-token' }
      }),
      LITELLM_ENV
    )

    // Graceful: the catalogue is temporarily unavailable, surfaced as a 503 +
    // Retry-After so the browser falls back to its built-in list — not a 429
    // (which would imply the browser itself is rate limited) and not a 502.
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('90')
    const body = edgeErrorResponseSchema.parse(await response.json())
    expect(body).toEqual({ error: 'Upstream service unavailable' })

    // The cold-start window-opener 429 is accepted at the call site, so it is
    // never captured (TINYTINKERER-EDGE-5).
    const captured429 = sink.mock.calls.some(
      ([, options]) =>
        options.tags?.['request_area'] === 'models.list' &&
        options.tags?.['failure_kind'] === 'http_error'
    )
    expect(captured429).toBe(false)
  })

  it('caches the models list and serves the second request without re-probing upstream (TINYTINKERER-EDGE-4)', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'openai/gpt-4.1', object: 'model' }]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        LITELLM_ENV
      )

    const expectedModels = {
      models: [
        {
          provider: 'litellm',
          id: 'openai/gpt-4.1',
          label: 'openai/gpt-4.1',
          kind: 'chat',
          publisher: 'openai'
        }
      ]
    }

    const first = await listRequest()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual(expectedModels)
    // A cache miss makes two upstream calls: the catalogue plus the
    // best-effort /model/info mode lookup (issue #179).
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
    expect(upstreamCalls(fetchSpy)[0]?.[0]).toBe(
      'https://litellm.labs.lair.nntin.xyz/v1/models'
    )
    expect(upstreamCalls(fetchSpy)[1]?.[0]).toBe(
      'https://litellm.labs.lair.nntin.xyz/model/info'
    )
    const headers = new Headers(upstreamCalls(fetchSpy)[0]?.[1]?.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer sk-tt-/)

    // Second request is served from the colo-wide cache — the upstream catalogue
    // is untouched, so we stop hammering LiteLLM on every page load.
    const second = await listRequest()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(expectedModels)
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
  })

  // Per-user LiteLLM keys make identity part of the model access decision. Even
  // a fresh catalogue cache must not be visible to a caller GitHub rejects.
  it('validates the caller before serving a fresh cached models list', async () => {
    const { store, cache } = makeCacheMock()
    store.set(
      cacheKeyForScope(DEFAULT_LITELLM_SCOPE),
      new Response(
        JSON.stringify([{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]),
        {
          headers: { 'x-models-cached-at': String(Date.now()) }
        }
      )
    )
    vi.stubGlobal('caches', { default: cache })
    // The cached catalogue exists, but the GitHub probe rejects the caller.
    // The catalogue fetch must never run.
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer would-be-rejected' }
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Unauthorized'
    })
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  it('scopes the models-list cache per LiteLLM base URL', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = withCallerValidation((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              {
                id:
                  new URL(toRequestUrl(input)).hostname ===
                  'litellm.example.com'
                    ? 'custom/model'
                    : 'openai/gpt-5',
                object: 'model'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const env = {
      ...LITELLM_ENV,
      LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
    }
    const listRequest = (baseUrl?: string) =>
      app.fetch(
        new Request(
          `http://localhost/api/models/list?provider=litellm${baseUrl ? `&litellmBaseUrl=${encodeURIComponent(baseUrl)}` : ''}`,
          { headers: { authorization: 'Bearer test-token' } }
        ),
        env
      )

    const defaultList = await listRequest()
    expect(
      ((await defaultList.json()) as { models: Array<{ id: string }> })
        .models[0]?.id
    ).toBe('openai/gpt-5')

    // A different allowlisted base URL is a separate catalogue: it must hit
    // upstream itself instead of being served the default deployment's cache.
    // Each cache miss is two upstream calls (catalogue + /model/info).
    const customList = await listRequest('https://litellm.example.com/')
    expect(
      ((await customList.json()) as { models: Array<{ id: string }> }).models[0]
        ?.id
    ).toBe('custom/model')
    expect(upstreamCalls(fetchSpy)).toHaveLength(4)
  })

  it('lists LiteLLM chat models through the shared-key proxy, dropping embedding models by mode and by name', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) {
        return Promise.resolve(githubUserOk())
      }
      if (isLiteLLMKeyManagementUrl(url)) {
        return Promise.resolve(litellmKeyManagementOk(input, init))
      }
      upstreamRequests.push({ input, init })
      if (url.endsWith('/model/info')) {
        // /model/info exposes the mode that /v1/models omits. voyage-2 has
        // no embedding hint in its NAME, so only this lookup can drop it;
        // gpt-5 is explicitly chat (issue #179).
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  model_name: 'openai/gpt-5',
                  model_info: { mode: 'chat' }
                },
                { model_name: 'voyage-2', model_info: { mode: 'embedding' } }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'openai/gpt-5', object: 'model' },
              { id: 'openai/text-embedding-3-small', object: 'model' },
              // Embedding models without 'embedding' in the id: caught by
              // the standalone 'embed' token / the /model/info mode.
              { id: 'cohere/embed-english-v3.0', object: 'model' },
              { id: 'voyage-2', object: 'model' }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer github-token' }
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [
        {
          provider: 'litellm',
          id: 'openai/gpt-5',
          label: 'openai/gpt-5',
          kind: 'chat',
          publisher: 'openai'
        }
      ]
    })
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamRequests[0]?.input).toBe(
      'https://litellm.labs.lair.nntin.xyz/v1/models'
    )
    expect(upstreamRequests[1]?.input).toBe(
      'https://litellm.labs.lair.nntin.xyz/model/info'
    )
    expect(
      new Headers(githubProbeCalls(fetchSpy)[0]?.[1]?.headers).get(
        'authorization'
      )
    ).toBe('Bearer github-token')
    // api.github.com 403s without a User-Agent; the caller-validation probe must
    // send one or every LiteLLM request is wrongly rejected as an invalid caller
    // (TINYTINKERER-FRONTEND-N/P/Q/R).
    expect(
      new Headers(githubProbeCalls(fetchSpy)[0]?.[1]?.headers).get('user-agent')
    ).toBe('tinytinkerer-edge')
    expect(
      new Headers(upstreamRequests[0]?.init?.headers).get('authorization')
    ).toMatch(/^Bearer sk-tt-/)
    expect(
      new Headers(upstreamRequests[1]?.init?.headers).get('authorization')
    ).toMatch(/^Bearer sk-tt-/)
  })

  it('proxies LiteLLM chat completions with the selected allowlisted base URL', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = toRequestUrl(input)
        if (url === GITHUB_USER_URL) {
          return Promise.resolve(githubUserOk())
        }
        if (isLiteLLMKeyManagementUrl(url)) {
          return Promise.resolve(litellmKeyManagementOk(input, init))
        }
        upstreamRequests.push({ input, init })
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'hi' } }]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      })
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          litellmBaseUrl: 'https://litellm.example.com/',
          model: 'openai/gpt-5',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {
        ...LITELLM_ENV,
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
      }
    )

    expect(response.status).toBe(200)
    expect(upstreamRequests[0]?.input).toBe(
      'https://litellm.example.com/v1/chat/completions'
    )
    const headers = new Headers(upstreamRequests[0]?.init?.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer sk-tt-/)
    const upstreamBody = upstreamRequests[0]?.init?.body
    if (typeof upstreamBody !== 'string') {
      throw new Error('Expected LiteLLM request body to be a JSON string')
    }
    const body = JSON.parse(upstreamBody) as {
      provider?: string
      litellmBaseUrl?: string
      model: string
    }
    expect(body.provider).toBeUndefined()
    expect(body.litellmBaseUrl).toBeUndefined()
    expect(body.model).toBe('openai/gpt-5')
  })

  it('rejects unallowlisted LiteLLM base URLs before validating or proxying', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request(
        'http://localhost/api/models/list?provider=litellm&litellmBaseUrl=https%3A%2F%2Fevil.example.com%2F',
        {
          headers: { authorization: 'Bearer github-token' }
        }
      ),
      LITELLM_ENV
    )

    expect(response.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM base URL is not allowed'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Mirror of the list-route test above: the chat route runs the same
  // allowlist guard before validating or proxying.
  it('rejects unallowlisted LiteLLM base URLs on chat before validating or proxying', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          litellmBaseUrl: 'https://evil.example.com/',
          model: 'openai/gpt-5',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM base URL is not allowed'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // A well-formed but non-https URL passes the contracts-level z.string().url()
  // check and must be rejected by the routes' own normalization on BOTH routes.
  it('rejects a non-https LiteLLM base URL with 400 on both models routes', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const insecureBaseUrl = 'http://litellm.example.com/'

    const chatResponse = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          litellmBaseUrl: insecureBaseUrl,
          model: 'openai/gpt-5',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )
    expect(chatResponse.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await chatResponse.json())).toEqual({
      error: 'Invalid LiteLLM base URL'
    })

    const listResponse = await app.fetch(
      new Request(
        `http://localhost/api/models/list?provider=litellm&litellmBaseUrl=${encodeURIComponent(insecureBaseUrl)}`,
        { headers: { authorization: 'Bearer github-token' } }
      ),
      LITELLM_ENV
    )
    expect(listResponse.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await listResponse.json())).toEqual({
      error: 'Invalid LiteLLM base URL'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 401 for invalid callers before provisioning a LiteLLM user key', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer bad-token' }
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Unauthorized'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when LiteLLM caller validation is unavailable', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response('github unavailable', { status: 503 })
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer github-token' }
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM caller validation is temporarily unavailable.'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // Mirrors of the list-route caller-validation tests above: the chat route
  // runs the same probe and must answer identically.
  it('returns 401 on chat for invalid callers before provisioning a LiteLLM user key', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer bad-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Unauthorized'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 503 on chat when LiteLLM caller validation is unavailable', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response('github unavailable', { status: 503 })
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM caller validation is temporarily unavailable.'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('caches a successful caller validation and skips the GitHub probe on subsequent calls (issue #177)', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    // First call probes GitHub once and caches the positive result.
    const first = await chatRequest()
    expect(first.status).toBe(200)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)

    // A ReAct prompt issues several edge calls back to back: the follow-ups
    // must reuse the cached validation instead of re-probing GitHub.
    const second = await chatRequest()
    expect(second.status).toBe(200)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
  })

  it('does not cache an invalid caller validation — revocation bites on the next call (issue #177)', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer bad-token' }
        }),
        LITELLM_ENV
      )

    const first = await listRequest()
    expect(first.status).toBe(401)
    const second = await listRequest()
    expect(second.status).toBe(401)
    // Negative results are never cached, so each call re-probes.
    expect(githubProbeCalls(fetchSpy)).toHaveLength(2)
  })

  it('does not cache an unavailable caller validation — a GitHub outage is never sticky (issue #177)', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(
          new Response('github unavailable', { status: 503 })
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        LITELLM_ENV
      )

    const first = await listRequest()
    expect(first.status).toBe(503)
    const second = await listRequest()
    expect(second.status).toBe(503)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(2)
  })

  it('checks the chat backoff window after identifying the GitHub user', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = (token: string) =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    // First token opens the backoff window for its GitHub identity.
    const first = await chatRequest('first-token')
    expect(first.status).toBe(429)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)

    // A different GitHub token still has to be identified before the route can
    // know whether it belongs to the same user-scoped LiteLLM bucket.
    const second = await chatRequest('second-token')
    expect(second.status).toBe(429)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(2)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('keeps one GitHub user’s chat backoff from affecting another user', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) {
        const authorization =
          new Headers(init?.headers).get('authorization') ?? ''
        const secondUser = authorization.includes('second-token')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: secondUser ? 67890 : 12345,
              login: secondUser ? 'other-user' : 'nntin'
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      if (isLiteLLMKeyManagementUrl(url)) {
        return Promise.resolve(litellmKeyManagementOk(input, init))
      }
      return Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = (token: string) =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    expect((await chatRequest('first-token')).status).toBe(429)
    expect((await chatRequest('second-token')).status).toBe(429)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(2)
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
  })

  it('re-provisions the per-user key after an upstream 401, clearing the durable marker as well as the in-memory one', async () => {
    // The durable Workers Cache marker is what makes this a real regression: if
    // an upstream 401 cleared only the in-memory mirror, readProvisionedMarker
    // would re-hydrate it from the durable entry and keep short-circuiting past
    // re-provisioning for the marker's full TTL. Stub `caches` so both layers
    // are live.
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    let chatCalls = 0
    const fetchSpy = withCallerValidation((input) => {
      const url = toRequestUrl(input)
      if (url.endsWith('/v1/chat/completions')) {
        chatCalls += 1
        // First proxied call: the provisioned key is rejected upstream (key
        // deleted / secret rotated). After re-provisioning, the retry succeeds.
        return Promise.resolve(
          chatCalls === 1
            ? new Response('unauthorized', { status: 401 })
            : new Response(
                JSON.stringify({
                  choices: [{ message: { role: 'assistant', content: 'hi' } }]
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
              )
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer github-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    const keyManagementCalls = () =>
      fetchSpy.mock.calls.filter(([input]) =>
        isLiteLLMKeyManagementUrl(toRequestUrl(input))
      ).length

    // First request provisions the key, then the upstream rejects it (401).
    const first = await chatRequest()
    expect(first.status).toBe(401)
    const afterFirst = keyManagementCalls()
    expect(afterFirst).toBeGreaterThan(0)

    // Second request: with both marker layers invalidated by the 401, the key
    // plane must be consulted again to re-provision. With only the in-memory
    // mirror cleared the durable marker would short-circuit this and the count
    // would not move.
    const second = await chatRequest()
    expect(second.status).toBe(200)
    expect(keyManagementCalls()).toBeGreaterThan(afterFirst)
  })

  // Per-user budgets hinge on each GitHub user spending through their OWN minted
  // LiteLLM key. If two users shared a derived key they would share a budget —
  // the feature would be pointless — so the proxied bearer MUST differ per user.
  it('mints a distinct per-user LiteLLM key for each GitHub user', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) {
        const authorization =
          new Headers(init?.headers).get('authorization') ?? ''
        const secondUser = authorization.includes('second-token')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: secondUser ? 67890 : 12345,
              login: secondUser ? 'other-user' : 'nntin'
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      if (isLiteLLMKeyManagementUrl(url)) {
        return Promise.resolve(litellmKeyManagementOk(input, init))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = (token: string) =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    await chatRequest('first-token')
    await chatRequest('second-token')

    const chatBearers = upstreamCalls(fetchSpy)
      .filter(([input]) => toRequestUrl(input).endsWith('/v1/chat/completions'))
      .map(([, init]) => new Headers(init?.headers).get('authorization'))
    expect(chatBearers).toHaveLength(2)
    expect(chatBearers[0]).toMatch(/^Bearer sk-tt-/)
    expect(chatBearers[1]).toMatch(/^Bearer sk-tt-/)
    // Different GitHub identities → different minted keys → different budgets.
    expect(chatBearers[0]).not.toBe(chatBearers[1])

    // The provisioning calls carry per-user identity, not a shared one.
    const generatedUserIds = fetchSpy.mock.calls
      .filter(([input]) => new URL(toRequestUrl(input)).pathname === '/key/generate')
      .map(([, init]) => {
        const raw = typeof init?.body === 'string' ? init.body : '{}'
        return (JSON.parse(raw) as { user_id?: string }).user_id
      })
    expect(new Set(generatedUserIds)).toEqual(
      new Set(['github-12345', 'github-67890'])
    )
  })

  it('returns 503 on chat when per-user key minting fails (no key to fall back to)', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) return Promise.resolve(githubUserOk())
      if (new URL(url).pathname === '/v2/key/info') {
        return Promise.resolve(
          new Response(JSON.stringify({ info: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      if (new URL(url).pathname === '/key/generate') {
        // Management key lacks permission to mint: provisioning cannot recover.
        return Promise.resolve(new Response('forbidden', { status: 403 }))
      }
      // The data-plane chat endpoint must never be reached without a key.
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM user key provisioning is temporarily unavailable.'
    })
    // No chat completion was attempted without a provisioned key.
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  it('returns 503 on models/list when per-user key minting fails', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) return Promise.resolve(githubUserOk())
      if (new URL(url).pathname === '/v2/key/info') {
        return Promise.resolve(
          new Response(JSON.stringify({ info: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      }
      if (new URL(url).pathname === '/key/generate') {
        return Promise.resolve(new Response('forbidden', { status: 403 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer github-token' }
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM user key provisioning is temporarily unavailable.'
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  // Budget exhaustion is an upstream 400 ("budget exceeded"), NOT a 401/403, so
  // it must be surfaced to the user verbatim AND must not invalidate the minted
  // key — re-provisioning a perfectly valid, merely-out-of-budget key would be
  // pointless churn that resets nothing.
  it('surfaces a LiteLLM budget-exhaustion 400 without re-provisioning the user key', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      if (url === GITHUB_USER_URL) return Promise.resolve(githubUserOk())
      if (isLiteLLMKeyManagementUrl(url)) {
        return Promise.resolve(litellmKeyManagementOk(input, init))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message:
                'ExceededBudget: Crossed spend within budget. Budget: 1.0, Spend: 1.2'
            }
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer github-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    const generateCalls = () =>
      fetchSpy.mock.calls.filter(
        ([input]) => new URL(toRequestUrl(input)).pathname === '/key/generate'
      ).length

    const first = await chatRequest()
    expect(first.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await first.json())).toEqual({
      error: 'ExceededBudget: Crossed spend within budget. Budget: 1.0, Spend: 1.2'
    })
    expect(generateCalls()).toBe(1)

    // A second call still reuses the provisioned key (the budget 400 did not
    // clear the key cache); no second mint.
    const second = await chatRequest()
    expect(second.status).toBe(400)
    expect(generateCalls()).toBe(1)
  })

  // GITHUB_ALLOWED_USERS gates which validated GitHub identities may spend
  // server-side resources. A forbidden caller must be rejected with a 403 BEFORE
  // any key is minted or any upstream resource is touched — on every gated route.
  it('returns 403 for a caller outside GITHUB_ALLOWED_USERS before minting a key or proxying chat', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      // The validated identity is id 12345 / login nntin; neither is allowed.
      { ...LITELLM_ENV, GITHUB_ALLOWED_USERS: 'someone-else,99999' }
    )

    expect(response.status).toBe(403)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Forbidden'
    })
    // Only the GitHub probe ran — no key minting, no chat completion.
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
    const keyManagementCalls = fetchSpy.mock.calls.filter(([input]) =>
      isLiteLLMKeyManagementUrl(toRequestUrl(input))
    )
    expect(keyManagementCalls).toHaveLength(0)
  })

  it('returns 403 on models/list for a caller outside GITHUB_ALLOWED_USERS', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(new Response('{}', { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer github-token' }
      }),
      { ...LITELLM_ENV, GITHUB_ALLOWED_USERS: 'someone-else' }
    )

    expect(response.status).toBe(403)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Forbidden'
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  it('admits a caller listed in GITHUB_ALLOWED_USERS by login', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      // The validated login `nntin` is on the allowlist (case-insensitive).
      { ...LITELLM_ENV, GITHUB_ALLOWED_USERS: 'NNTin' }
    )

    expect(response.status).toBe(200)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('returns 403 for a forbidden caller before spending the shared Tavily key', async () => {
    const fetchSpy = withCallerValidation((input) => {
      // The search proxy must never run for a forbidden caller.
      expect(toRequestUrl(input)).not.toContain('tavily')
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      { TAVILY_API_KEY: 'tavily-shared-key', GITHUB_ALLOWED_USERS: 'someone-else' }
    )

    expect(response.status).toBe(403)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Forbidden'
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(0)
  })

  it('serves the last-known list when upstream is rate limited, breaking the 429 cascade (TINYTINKERER-FRONTEND-5)', async () => {
    const { store, cache } = makeCacheMock()
    // Seed a previously-cached catalogue old enough to be past the fresh window.
    store.set(
      cacheKeyForScope(DEFAULT_LITELLM_SCOPE),
      new Response(
        JSON.stringify([{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]),
        {
          headers: { 'x-models-cached-at': String(Date.now() - 10 * 60_000) }
        }
      )
    )
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer test-token' }
      }),
      LITELLM_ENV
    )

    // Upstream 429'd once (backoff recorded), but the browser gets a usable list
    // instead of a propagated 429 — no cascade into TINYTINKERER-FRONTEND-5.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('serves the last-known list while the backoff window is open without re-probing upstream', async () => {
    const { store, cache } = makeCacheMock()
    // Seed a previously-cached catalogue old enough to be past the fresh window,
    // so every request takes the backoff-check path instead of the fresh-hit one.
    store.set(
      cacheKeyForScope(DEFAULT_LITELLM_SCOPE),
      new Response(
        JSON.stringify([{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]),
        {
          headers: { 'x-models-cached-at': String(Date.now() - 10 * 60_000) }
        }
      )
    )
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        LITELLM_ENV
      )

    // First call probes upstream, gets 429, records the window, and falls back
    // to the last-known catalogue.
    const first = await listRequest()
    expect(first.status).toBe(200)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)

    // Second call arrives while the window is still open WITH a warm catalogue
    // cache: it must serve the last-known list from the backoff branch — a 200,
    // not the no-cache 503 — without touching upstream again.
    const second = await listRequest()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]
    })
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('keeps the models/list cooldown single-valued: an open window with no cache yields a 503, never a raw 429 (TINYTINKERER-FRONTEND-C)', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        LITELLM_ENV
      )

    // First call: cold cache miss, upstream 429 → graceful 503 + Retry-After, and
    // the backoff window is recorded.
    const first = await listRequest()
    expect(first.status).toBe(503)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)

    // Second call: the window is still open and nothing is cached. It must emit
    // the SAME 503 cooldown signal (not a raw 429) without re-probing upstream.
    const second = await listRequest()
    expect(second.status).toBe(503)
    expect(second.headers.get('Retry-After')).not.toBeNull()
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
  })

  it('backs off subsequent LiteLLM calls while the rate-limit window is open (TINYTINKERER-EDGE-4)', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        LITELLM_ENV
      )

    // First call hits upstream, gets 429, and records the backoff window.
    const first = await chatRequest()
    expect(first.status).toBe(429)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)

    // Second call is short-circuited with a 429 without touching upstream.
    const second = await chatRequest()
    expect(second.status).toBe(429)
    expect(second.headers.get('Retry-After')).not.toBeNull()
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
    const body = (await second.json()) as Record<string, unknown>
    rateLimitPayloadSchema.parse(body)
  })

  it('keeps backoff windows separate per LiteLLM deployment (issue #146)', async () => {
    const fetchSpy = withCallerValidation(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const env = {
      ...LITELLM_ENV,
      LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
    }
    const chatRequest = (baseUrl?: string) =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-token'
          },
          body: JSON.stringify({
            provider: 'litellm',
            ...(baseUrl ? { litellmBaseUrl: baseUrl } : {}),
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        env
      )

    // The default deployment hits upstream, gets 429, and records its window.
    const first = await chatRequest()
    expect(first.status).toBe(429)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)

    // The default deployment is now short-circuited (window open for its scope).
    await chatRequest()
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)

    // A DIFFERENT allowlisted deployment has its own upstream quota and must NOT
    // be short-circuited by the first one's window — it reaches upstream itself.
    const other = await chatRequest('https://litellm.example.com/')
    expect(other.status).toBe(429)
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
  })

  it('returns a typed models error for upstream authentication failures', async () => {
    const sink = vi.fn<CaptureExceptionSink>()
    setCaptureExceptionSink(sink)
    vi.stubGlobal(
      'fetch',
      withCallerValidation(() =>
        Promise.resolve(
          new Response('upstream unauthorized', {
            status: 401,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      LITELLM_ENV
    )

    expect(response.status).toBe(401)
    const body = edgeErrorResponseSchema.parse(await response.json())
    expect(body).toEqual({
      error:
        'Authentication failed. The LiteLLM user virtual key may be invalid.'
    })
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'models.chat',
      request_origin: 'litellm',
      http_status: 401,
      model: 'openai/gpt-4.1-mini'
    })
    expect(options?.contexts?.request).toMatchObject({
      model: 'openai/gpt-4.1-mini'
    })
    expect(options?.fingerprint).toContain('model:openai/gpt-4.1-mini')
  })

  // Mirror of the chat-route upstream-error mapping above: the list route maps
  // non-429 upstream failures through the same status/message table.
  it('maps non-429 upstream errors on models/list to typed errors and unknown statuses to 502', async () => {
    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list?provider=litellm', {
          headers: { authorization: 'Bearer test-token' }
        }),
        LITELLM_ENV
      )

    // A mapped upstream status (401) keeps its status code and gets the typed
    // message instead of leaking the upstream body.
    vi.stubGlobal(
      'fetch',
      withCallerValidation(() =>
        Promise.resolve(new Response('upstream unauthorized', { status: 401 }))
      )
    )
    const mapped = await listRequest()
    expect(mapped.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await mapped.json())).toEqual({
      error:
        'Authentication failed. The LiteLLM user virtual key may be invalid.'
    })

    // An unmapped upstream status collapses to a 502 with a generic message.
    vi.stubGlobal(
      'fetch',
      withCallerValidation(() =>
        Promise.resolve(new Response('teapot', { status: 418 }))
      )
    )
    const unmapped = await listRequest()
    expect(unmapped.status).toBe(502)
    expect(edgeErrorResponseSchema.parse(await unmapped.json())).toEqual({
      error: 'Upstream error 418'
    })
  })

  it('preserves LiteLLM bad-request details for unsupported chat models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = toRequestUrl(input)
        if (url === GITHUB_USER_URL) {
          return Promise.resolve(githubUserOk())
        }
        if (isLiteLLMKeyManagementUrl(url)) {
          return Promise.resolve(litellmKeyManagementOk(input, init))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message:
                  "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
              }
            }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      })
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer github-token'
        },
        body: JSON.stringify({
          provider: 'litellm',
          litellmBaseUrl: 'https://litellm.example.com/',
          model: 'chatgpt/gpt-5.3-codex',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {
        ...LITELLM_ENV,
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
      }
    )

    expect(response.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error:
        "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
    })
  })

  it('echoes an allowlisted origin for standard responses and preflight', async () => {
    const env = {
      ALLOWED_ORIGINS: 'http://localhost:3111, https://tiny.nntin.xyz'
    }

    const response = await app.fetch(
      new Request('http://localhost/health', {
        headers: { origin: 'http://localhost:3111' }
      }),
      env
    )

    const preflightResponse = await app.fetch(
      new Request('http://localhost/health', {
        method: 'OPTIONS',
        headers: { origin: 'https://tiny.nntin.xyz' }
      }),
      env
    )

    systemStatusSchema.parse(await response.json())
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3111'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(preflightResponse.status).toBe(204)
    expect(preflightResponse.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://tiny.nntin.xyz'
    )
  })

  it('echoes wildcard preview origins for Vercel preview domains', async () => {
    const response = await app.fetch(
      new Request('http://localhost/health', {
        headers: { origin: 'https://pr-123-feature.tiny.preview.nntin.xyz' }
      }),
      { ALLOWED_ORIGINS: 'https://*.tiny.preview.nntin.xyz' }
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://pr-123-feature.tiny.preview.nntin.xyz'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('omits cors origin headers for disallowed origins', async () => {
    const response = await app.fetch(
      new Request('http://localhost/health', {
        headers: { origin: 'https://evil.example' }
      }),
      {
        ALLOWED_ORIGINS:
          'http://localhost:3111, https://*.tiny.preview.nntin.xyz'
      }
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('rejects nested preview subdomains for wildcard entries', async () => {
    const response = await app.fetch(
      new Request('http://localhost/health', {
        headers: { origin: 'https://nested.pr-123.tiny.preview.nntin.xyz' }
      }),
      { ALLOWED_ORIGINS: 'https://*.tiny.preview.nntin.xyz' }
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('applies the resolved cors origin to streaming model responses', async () => {
    vi.stubGlobal(
      'fetch',
      withCallerValidation(() =>
        Promise.resolve(
          new Response('data: {"id":"stream"}\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      )
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
          origin: 'http://localhost:3111'
        },
        body: JSON.stringify({
          provider: 'litellm',
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      { ...LITELLM_ENV, ALLOWED_ORIGINS: 'http://localhost:3111' }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3111'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
    await expect(response.text()).resolves.toContain('data: {"id":"stream"}')
  })
})
