import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  edgeErrorResponseSchema,
  rateLimitPayloadSchema,
  systemStatusSchema
} from '@tinytinkerer/contracts'
import {
  setCaptureExceptionSink,
  type CaptureExceptionSink
} from '@tinytinkerer/sentry-telemetry'
import app from './index.js'
import { CACHE_KEY } from './lib/models-cache.js'
import { clearModelsBackoff } from './lib/rate-limit.js'

// Minimal in-memory stand-in for Cloudflare's `caches.default`. Responses are
// cloned on read/write so their single-use bodies survive multiple matches.
const makeCacheMock = () => {
  const store = new Map<string, Response>()
  // The route only ever keys the cache by the string CACHE_KEY, so the mock
  // takes a string directly (the real Cache API accepts RequestInfo | URL).
  const cache = {
    match: (key: string) => Promise.resolve(store.get(key)?.clone()),
    put: (key: string, res: Response) => {
      store.set(key, res.clone())
      return Promise.resolve()
    }
  }
  return { store, cache }
}

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('edge routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    // The GitHub Models backoff window is module-level (per-isolate); reset it so
    // a 429 in one test doesn't short-circuit the next.
    clearModelsBackoff()
    // Drop any telemetry sink a test registered so captures don't leak across.
    setCaptureExceptionSink(null)
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
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      upstreamRequests.push({ input, init })
      return Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4.1-mini',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {}
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(upstreamRequests[0]?.input).toBe(
      'https://models.github.ai/inference/chat/completions'
    )
    const headers = new Headers(upstreamRequests[0]?.init?.headers)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2026-03-10')
    expect(headers.get('authorization')).toBe('Bearer test-token')
    const body = (await response.json()) as Record<string, unknown>
    rateLimitPayloadSchema.parse(body)
    expect(body['code']).toBe('rate_limited')
    expect(body['error']).toBe('GitHub Models rate limit reached')
    expect(body['retryAfterMs']).toBe(120_000)
  })

  it('serves a graceful 503 (not a 502, not a raw 429) on a cold-cache-miss models/list rate limit, and does not capture the window-opener (TINYTINKERER-EDGE-5)', async () => {
    // No cache stub → cold isolate with an empty Cache API: the upstream fetch is
    // the unavoidable cold-cache-miss window-opener.
    const sink = vi.fn<CaptureExceptionSink>()
    setCaptureExceptionSink(sink)
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '90' }
          })
        )
      )
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/list', {
        headers: { authorization: 'Bearer test-token' }
      }),
      {}
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
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      upstreamRequests.push({ input, init })
      return Promise.resolve(
        new Response(
          JSON.stringify([{ id: 'openai/gpt-4.1', name: 'GPT-4.1' }]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/list', {
          headers: { authorization: 'Bearer test-token' }
        }),
        {}
      )

    const first = await listRequest()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      models: [
        {
          provider: 'github',
          id: 'openai/gpt-4.1',
          label: 'GPT-4.1',
          name: 'GPT-4.1',
          kind: 'chat'
        }
      ]
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(upstreamRequests[0]?.input).toBe(
      'https://models.github.ai/catalog/models'
    )
    const headers = new Headers(upstreamRequests[0]?.init?.headers)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2026-03-10')
    expect(headers.get('authorization')).toBe('Bearer test-token')

    // Second request is served from the colo-wide cache — upstream is untouched,
    // so we stop hammering GitHub Models on every page load.
    const second = await listRequest()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      models: [
        {
          provider: 'github',
          id: 'openai/gpt-4.1',
          label: 'GPT-4.1',
          name: 'GPT-4.1',
          kind: 'chat'
        }
      ]
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('lists OpenRouter text-output models through the provider-aware proxy', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequests.push({ input, init })
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'openai/gpt-4o',
                  name: 'GPT-4o',
                  description: 'Text model',
                  context_length: 128000,
                  architecture: {
                    input_modalities: ['text'],
                    output_modalities: ['text']
                  },
                  supported_parameters: ['tools']
                },
                {
                  id: 'example/image-only',
                  name: 'Image Only',
                  architecture: { output_modalities: ['image'] }
                }
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
      new Request('http://localhost/api/models/list?provider=openrouter', {
        headers: { authorization: 'Bearer openrouter-key' }
      }),
      {}
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [
        {
          provider: 'openrouter',
          id: 'openai/gpt-4o',
          label: 'GPT-4o',
          kind: 'chat',
          name: 'GPT-4o',
          publisher: 'openai',
          summary: 'Text model',
          context_length: 128000,
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['text']
          },
          capabilities: ['tools'],
          limits: { max_input_tokens: 128000 },
          supported_input_modalities: ['text'],
          supported_output_modalities: ['text']
        }
      ]
    })
    expect(upstreamRequests[0]?.input).toBe(
      'https://openrouter.ai/api/v1/models'
    )
    const headers = new Headers(upstreamRequests[0]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer openrouter-key')
    expect(headers.get('HTTP-Referer')).toBe('https://tiny.nntin.xyz')
    expect(headers.get('X-OpenRouter-Title')).toBe('TinyTinkerer')
  })

  it('proxies OpenRouter chat completions with the selected provider', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
          authorization: 'Bearer openrouter-key'
        },
        body: JSON.stringify({
          provider: 'openrouter',
          model: 'openai/gpt-4o',
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {}
    )

    expect(response.status).toBe(200)
    expect(upstreamRequests[0]?.input).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    )
    const headers = new Headers(upstreamRequests[0]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer openrouter-key')
    const upstreamBody = upstreamRequests[0]?.init?.body
    if (typeof upstreamBody !== 'string') {
      throw new Error('Expected OpenRouter request body to be a JSON string')
    }
    const body = JSON.parse(upstreamBody) as {
      provider?: string
      model: string
    }
    expect(body.provider).toBeUndefined()
    expect(body.model).toBe('openai/gpt-4o')
  })

  it('lists LiteLLM chat models through the shared-key proxy', async () => {
    const upstreamRequests: Array<{
      input: RequestInfo | URL
      init: RequestInit | undefined
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequests.push({ input, init })
        if (toRequestUrl(input) === 'https://api.github.com/user') {
          return Promise.resolve(
            new Response(JSON.stringify({ login: 'nntin' }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              object: 'list',
              data: [
                { id: 'openai/gpt-5', object: 'model' },
                { id: 'openai/text-embedding-3-small', object: 'model' }
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
      { LITELLM_API_KEY: 'litellm-shared-key' }
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
    expect(upstreamRequests[0]?.input).toBe('https://api.github.com/user')
    expect(upstreamRequests[1]?.input).toBe(
      'https://litellm.labs.lair.nntin.xyz/v1/models'
    )
    expect(new Headers(upstreamRequests[0]?.init?.headers).get('authorization')).toBe(
      'Bearer github-token'
    )
    expect(new Headers(upstreamRequests[1]?.init?.headers).get('authorization')).toBe(
      'Bearer litellm-shared-key'
    )
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
        if (toRequestUrl(input) === 'https://api.github.com/user') {
          return Promise.resolve(
            new Response(JSON.stringify({ login: 'nntin' }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          )
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
        LITELLM_ALLOWED_BASE_URLS: 'https://litellm.example.com'
      }
    )

    expect(response.status).toBe(200)
    expect(upstreamRequests[0]?.input).toBe('https://api.github.com/user')
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
      { LITELLM_API_KEY: 'litellm-shared-key' }
    )

    expect(response.status).toBe(400)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM base URL is not allowed'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 401 for invalid callers before using the shared LiteLLM key', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === 'https://api.github.com/user') {
        return Promise.resolve(new Response('bad credentials', { status: 401 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list?provider=litellm', {
        headers: { authorization: 'Bearer bad-token' }
      }),
      { LITELLM_API_KEY: 'litellm-shared-key' }
    )

    expect(response.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'Unauthorized'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 503 when LiteLLM caller validation is unavailable', async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === 'https://api.github.com/user') {
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
      { LITELLM_API_KEY: 'litellm-shared-key' }
    )

    expect(response.status).toBe(503)
    expect(edgeErrorResponseSchema.parse(await response.json())).toEqual({
      error: 'LiteLLM caller validation is temporarily unavailable.'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('serves the last-known list when upstream is rate limited, breaking the 429 cascade (TINYTINKERER-FRONTEND-5)', async () => {
    const { store, cache } = makeCacheMock()
    // Seed a previously-cached catalogue old enough to be past the fresh window.
    store.set(
      CACHE_KEY,
      new Response(
        JSON.stringify([{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]),
        {
          headers: { 'x-models-cached-at': String(Date.now() - 10 * 60_000) }
        }
      )
    )
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const response = await app.fetch(
      new Request('http://localhost/api/models/list', {
        headers: { authorization: 'Bearer test-token' }
      }),
      {}
    )

    // Upstream 429'd once (backoff recorded), but the browser gets a usable list
    // instead of a propagated 429 — no cascade into TINYTINKERER-FRONTEND-5.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the models/list cooldown single-valued: an open window with no cache yields a 503, never a raw 429 (TINYTINKERER-FRONTEND-C)', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = vi.fn(() =>
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
        new Request('http://localhost/api/models/list', {
          headers: { authorization: 'Bearer test-token' }
        }),
        {}
      )

    // First call: cold cache miss, upstream 429 → graceful 503 + Retry-After, and
    // the backoff window is recorded.
    const first = await listRequest()
    expect(first.status).toBe(503)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call: the window is still open and nothing is cached. It must emit
    // the SAME 503 cooldown signal (not a raw 429) without re-probing upstream.
    const second = await listRequest()
    expect(second.status).toBe(503)
    expect(second.headers.get('Retry-After')).not.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('backs off subsequent GitHub Models calls while the rate-limit window is open (TINYTINKERER-EDGE-4)', async () => {
    const fetchSpy = vi.fn(() =>
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
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        {}
      )

    // First call hits upstream, gets 429, and records the backoff window.
    const first = await chatRequest()
    expect(first.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call is short-circuited with a 429 without touching upstream.
    const second = await chatRequest()
    expect(second.status).toBe(429)
    expect(second.headers.get('Retry-After')).not.toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = (await second.json()) as Record<string, unknown>
    rateLimitPayloadSchema.parse(body)
  })

  it('does not let one caller’s rate-limit short-circuit a different caller (issue #146)', async () => {
    const fetchSpy = vi.fn(() =>
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
            model: 'openai/gpt-4.1-mini',
            stream: false,
            messages: [{ role: 'user', content: 'hello' }]
          })
        }),
        {}
      )

    // Caller A hits upstream, gets 429, and records a backoff window for its token.
    const first = await chatRequest('token-a')
    expect(first.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Caller A is now short-circuited (window is open for its credential).
    await chatRequest('token-a')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Caller B forwards a DIFFERENT token, so it has its own upstream quota and
    // must NOT be short-circuited by A's window — it reaches upstream itself.
    const other = await chatRequest('token-b')
    expect(other.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns a typed models error for upstream authentication failures', async () => {
    const sink = vi.fn<CaptureExceptionSink>()
    setCaptureExceptionSink(sink)
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
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
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {}
    )

    expect(response.status).toBe(401)
    const body = edgeErrorResponseSchema.parse(await response.json())
    expect(body).toEqual({
      error:
        'Authentication failed. Your GitHub token may be invalid or expired.'
    })
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'models.chat',
      request_origin: 'github',
      http_status: 401,
      model: 'openai/gpt-4.1-mini'
    })
    expect(options?.contexts?.request).toMatchObject({
      model: 'openai/gpt-4.1-mini'
    })
    expect(options?.fingerprint).toContain('model:openai/gpt-4.1-mini')
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
      vi.fn(() =>
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
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      { ALLOWED_ORIGINS: 'http://localhost:3111' }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3111'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
    await expect(response.text()).resolves.toContain('data: {"id":"stream"}')
  })
})
