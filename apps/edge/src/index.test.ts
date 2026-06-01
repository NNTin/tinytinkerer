import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  edgeErrorResponseSchema,
  rateLimitPayloadSchema,
  systemStatusSchema
} from '@tinytinkerer/contracts'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'
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
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '120' }
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
          stream: false,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {}
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
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
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4.1', name: 'GPT-4.1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
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

    const first = await listRequest()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second request is served from the colo-wide cache — upstream is untouched,
    // so we stop hammering GitHub Models on every page load.
    const second = await listRequest()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('serves the last-known list when upstream is rate limited, breaking the 429 cascade (TINYTINKERER-FRONTEND-5)', async () => {
    const { store, cache } = makeCacheMock()
    // Seed a previously-cached catalogue old enough to be past the fresh window.
    store.set(
      CACHE_KEY,
      new Response(JSON.stringify([{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }]), {
        headers: { 'x-models-cached-at': String(Date.now() - 10 * 60_000) }
      })
    )
    vi.stubGlobal('caches', { default: cache })
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } })
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
    expect(await response.json()).toEqual({ models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('backs off subsequent GitHub Models calls while the rate-limit window is open (TINYTINKERER-EDGE-4)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const chatRequest = () =>
      app.fetch(
        new Request('http://localhost/api/models/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
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

  it('returns a typed models error for upstream authentication failures', async () => {
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
  })

  it('echoes an allowlisted origin for standard responses and preflight', async () => {
    const env = {
      ALLOWED_ORIGINS: 'http://localhost:3000, https://tiny.nntin.xyz'
    }

    const response = await app.fetch(
      new Request('http://localhost/health', {
        headers: { origin: 'http://localhost:3000' }
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
      'http://localhost:3000'
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
          'http://localhost:3000, https://*.tiny.preview.nntin.xyz'
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
          origin: 'http://localhost:3000'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      { ALLOWED_ORIGINS: 'http://localhost:3000' }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
    await expect(response.text()).resolves.toContain('data: {"id":"stream"}')
  })
})
