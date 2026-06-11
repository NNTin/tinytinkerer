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
import { clearModelsBackoff } from './lib/rate-limit.js'

// Minimal in-memory stand-in for Cloudflare's `caches.default`. Responses are
// cloned on read/write so their single-use bodies survive multiple matches.
const makeCacheMock = () => {
  const store = new Map<string, Response>()
  // The route only ever keys the cache by a string key, so the mock takes a
  // string directly (the real Cache API accepts RequestInfo | URL).
  const cache = {
    match: (key: string) => Promise.resolve(store.get(key)?.clone()),
    put: (key: string, res: Response) => {
      store.set(key, res.clone())
      return Promise.resolve()
    },
    delete: (key: string) => Promise.resolve(store.delete(key))
  }
  return { store, cache }
}

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

// Every models route validates the caller's GitHub identity before touching the
// shared LiteLLM key, so model tests need both the env and a mocked
// api.github.com/user probe. LITELLM_BASE_URL is required too: there is no
// code-level fallback (issue #179).
const LITELLM_ENV = {
  LITELLM_API_KEY: 'litellm-shared-key',
  LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/'
}
const GITHUB_USER_URL = 'https://api.github.com/user'
const githubUserOk = () =>
  new Response(JSON.stringify({ login: 'nntin' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

/** Fetch stub that answers the caller-validation probe and delegates the rest. */
const withCallerValidation = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (toRequestUrl(input) === GITHUB_USER_URL) {
      return Promise.resolve(githubUserOk())
    }
    return handler(input, init)
  })

/** Upstream fetches excluding the caller-validation probe. */
const upstreamCalls = (
  fetchSpy: ReturnType<typeof vi.fn>
): Array<[RequestInfo | URL, RequestInit | undefined]> =>
  (fetchSpy.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>).filter(
    ([input]) => toRequestUrl(input) !== GITHUB_USER_URL
  )

/** Calls to the api.github.com/user caller-validation probe only. */
const githubProbeCalls = (
  fetchSpy: ReturnType<typeof vi.fn>
): Array<[RequestInfo | URL, RequestInit | undefined]> =>
  (fetchSpy.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>).filter(
    ([input]) => toRequestUrl(input) === GITHUB_USER_URL
  )

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
    expect(headers.get('authorization')).toBe('Bearer litellm-shared-key')
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

  // A missing LITELLM_BASE_URL is "not configured" exactly like a missing
  // key: a fork that forgets the var must get a clear 503, not be silently
  // pointed at the maintainer's deployment (issue #179).
  it.each([
    ['nothing is set', {}],
    ['the base URL is missing', { LITELLM_API_KEY: 'litellm-shared-key' }],
    [
      'the key is missing',
      { LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/' }
    ]
  ])('returns 503 when LiteLLM is not configured (%s)', async (_label, env) => {
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
      error: 'LiteLLM is not configured.'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
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
      'openai/gpt-5'
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
    expect(headers.get('authorization')).toBe('Bearer litellm-shared-key')

    // Second request is served from the colo-wide cache — the upstream catalogue
    // is untouched, so we stop hammering LiteLLM on every page load.
    const second = await listRequest()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(expectedModels)
    expect(upstreamCalls(fetchSpy)).toHaveLength(2)
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
                id: new URL(toRequestUrl(input)).hostname === 'litellm.example.com'
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
    expect(((await defaultList.json()) as { models: Array<{ id: string }> }).models[0]?.id).toBe('openai/gpt-5')

    // A different allowlisted base URL is a separate catalogue: it must hit
    // upstream itself instead of being served the default deployment's cache.
    // Each cache miss is two upstream calls (catalogue + /model/info).
    const customList = await listRequest('https://litellm.example.com/')
    expect(((await customList.json()) as { models: Array<{ id: string }> }).models[0]?.id).toBe('custom/model')
    expect(upstreamCalls(fetchSpy)).toHaveLength(4)
  })

  it('lists LiteLLM chat models through the shared-key proxy, dropping embedding models by mode and by name', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequests.push({ input, init })
        const url = toRequestUrl(input)
        if (url === GITHUB_USER_URL) {
          return Promise.resolve(githubUserOk())
        }
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
    )

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
    expect(upstreamRequests[0]?.input).toBe(GITHUB_USER_URL)
    expect(upstreamRequests[1]?.input).toBe(
      'https://litellm.labs.lair.nntin.xyz/v1/models'
    )
    expect(upstreamRequests[2]?.input).toBe(
      'https://litellm.labs.lair.nntin.xyz/model/info'
    )
    expect(
      new Headers(upstreamRequests[0]?.init?.headers).get('authorization')
    ).toBe('Bearer github-token')
    // api.github.com 403s without a User-Agent; the caller-validation probe must
    // send one or every LiteLLM request is wrongly rejected as an invalid caller
    // (TINYTINKERER-FRONTEND-N/P/Q/R).
    expect(
      new Headers(upstreamRequests[0]?.init?.headers).get('user-agent')
    ).toBe('tinytinkerer-edge')
    expect(
      new Headers(upstreamRequests[1]?.init?.headers).get('authorization')
    ).toBe('Bearer litellm-shared-key')
    expect(
      new Headers(upstreamRequests[2]?.init?.headers).get('authorization')
    ).toBe('Bearer litellm-shared-key')
  })

  it('proxies LiteLLM chat completions with the selected allowlisted base URL', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequests.push({ input, init })
        if (toRequestUrl(input) === GITHUB_USER_URL) {
          return Promise.resolve(githubUserOk())
        }
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
        LITELLM_API_KEY: 'litellm-shared-key',
        LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz/',
        LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
      }
    )

    expect(response.status).toBe(200)
    expect(upstreamRequests[0]?.input).toBe(GITHUB_USER_URL)
    expect(upstreamRequests[1]?.input).toBe(
      'https://litellm.example.com/v1/chat/completions'
    )
    const headers = new Headers(upstreamRequests[1]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer litellm-shared-key')
    const upstreamBody = upstreamRequests[1]?.init?.body
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

  it('returns 401 for invalid callers before using the shared LiteLLM key', async () => {
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

  it('checks the chat backoff window before probing GitHub (issue #177)', async () => {
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

    // First caller opens the (deployment-wide) backoff window.
    const first = await chatRequest('first-token')
    expect(first.status).toBe(429)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)

    // A DIFFERENT caller (validation not cached for this token) arrives while
    // the window is open: the 429 short-circuit must answer before the GitHub
    // probe, so no new probe is spent just to be told to back off.
    const second = await chatRequest('second-token')
    expect(second.status).toBe(429)
    expect(githubProbeCalls(fetchSpy)).toHaveLength(1)
    expect(upstreamCalls(fetchSpy)).toHaveLength(1)
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
        'Authentication failed. The configured LiteLLM virtual key may be invalid.'
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

  it('preserves LiteLLM bad-request details for unsupported chat models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (toRequestUrl(input) === GITHUB_USER_URL) {
          return Promise.resolve(githubUserOk())
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
        LITELLM_API_KEY: 'litellm-shared-key',
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
