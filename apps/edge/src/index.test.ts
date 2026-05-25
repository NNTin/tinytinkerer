import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  edgeErrorResponseSchema,
  rateLimitPayloadSchema,
  systemStatusSchema
} from '@tinytinkerer/contracts'
import app from './index.js'

describe('edge routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      {}
	    )
	
	    expect(response.status).toBe(503)
	    const body = edgeErrorResponseSchema.parse(await response.json())
	    expect(body).toEqual({
	      error: 'Web search is currently unavailable. Configure Tavily to enable live search.'
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
    const body = await response.json() as Record<string, unknown>
    rateLimitPayloadSchema.parse(body)
    expect(body['code']).toBe('rate_limited')
    expect(body['error']).toBe('GitHub Models rate limit reached')
    expect(body['retryAfterMs']).toBe(120_000)
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
	      error: 'Authentication failed. Your GitHub token may be invalid or expired.'
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
	    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
	    expect(response.headers.get('Vary')).toBe('Origin')
	    expect(preflightResponse.status).toBe(204)
    expect(preflightResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://tiny.nntin.xyz')
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
      { ALLOWED_ORIGINS: 'http://localhost:3000, https://*.tiny.preview.nntin.xyz' }
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
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
    expect(response.headers.get('Vary')).toBe('Origin')
    await expect(response.text()).resolves.toContain('data: {"id":"stream"}')
  })
})
