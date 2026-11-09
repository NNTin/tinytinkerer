import { afterEach, describe, expect, it, vi } from 'vitest'
import { edgeErrorResponseSchema } from '@tinytinkerer/contracts'
import app from '../index.js'
import { clearCallerValidationCache } from '../lib/caller-validation-cache.js'
import { clearInboundRateLimits } from '../lib/inbound-rate-limit.js'
import { clearLiteLLMUserKeyCache } from '../lib/litellm-user-keys.js'
import { clearModelsBackoff } from '../lib/rate-limit.js'

// Route-level coverage for the per-origin sign-in policy (issue #510 T3,
// lib/require-auth-origins.ts). Every outbound request is recorded at the
// global `fetch` boundary so the tests can prove a rejected request never
// reached GitHub, LiteLLM's key-management API, Tavily, or an MCP server.

const REQUIRED_ORIGIN = 'https://canfactory-preview.nntin.xyz'
const OTHER_ORIGIN = 'https://dev.tiny.nntin.xyz'

const ENV = {
  ALLOWED_ORIGINS: `${OTHER_ORIGIN},${REQUIRED_ORIGIN},http://localhost:5173`,
  REQUIRE_AUTH_ORIGINS: `${REQUIRED_ORIGIN},http://localhost:5173`,
  LITELLM_KEY_MANAGEMENT_API_KEY: 'litellm-management-key',
  LITELLM_USER_KEY_SECRET: 'litellm-user-key-secret',
  LITELLM_BASE_URL: 'https://litellm.example.test/',
  TAVILY_API_KEY: 'tavily-key'
}

const toRequestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/**
 * Record every outbound request. GitHub rejects every token (so a present but
 * invalid token stays invalid); LiteLLM key management answers like an empty
 * key store; everything else is a 503 so a route that got through surfaces it.
 */
const stubOutbound = () => {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = toRequestUrl(input)
      urls.push(url)
      const { pathname } = new URL(url)
      if (url.startsWith('https://api.github.com/user')) {
        return Promise.resolve(new Response('{}', { status: 401 }))
      }
      if (pathname === '/v2/key/info') {
        return Promise.resolve(Response.json({ key: [], info: [] }))
      }
      if (pathname === '/key/generate') {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          key?: string
        }
        return Promise.resolve(Response.json({ key: body.key ?? 'sk-tt-test' }))
      }
      return Promise.resolve(Response.json({ error: 'upstream unavailable' }, { status: 503 }))
    })
  )
  return urls
}

type Call = { method: 'GET' | 'POST'; path: string; body?: unknown }

const ROUTES: Array<[string, Call]> = [
  ['models/list', { method: 'GET', path: '/api/models/list' }],
  [
    'models/chat',
    {
      method: 'POST',
      path: '/api/models/chat',
      body: { provider: 'litellm', stream: false, messages: [{ role: 'user', content: 'hi' }] }
    }
  ],
  ['search', { method: 'POST', path: '/api/search', body: { query: 'kicad wire guide' } }],
  [
    'mcp/discover',
    { method: 'POST', path: '/api/mcp/discover', body: { url: 'https://mcp.example.test/mcp' } }
  ],
  [
    'mcp/call',
    {
      method: 'POST',
      path: '/api/mcp/call',
      body: { url: 'https://mcp.example.test/mcp', toolName: 'get_project', arguments: {} }
    }
  ]
]

const send = (
  { method, path, body }: Call,
  { origin, authorization }: { origin?: string; authorization?: string }
) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(origin ? { origin } : {}),
        ...(authorization ? { authorization } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    ENV
  )

afterEach(() => {
  vi.unstubAllGlobals()
  clearInboundRateLimits()
  clearModelsBackoff()
  clearCallerValidationCache()
  void clearLiteLLMUserKeyCache()
})

describe('REQUIRE_AUTH_ORIGINS', () => {
  it.each(ROUTES)(
    '%s: a required origin without a token gets 401 and makes no outbound request',
    async (_label, call) => {
      const outbound = stubOutbound()

      const res = await send(call, { origin: REQUIRED_ORIGIN })

      expect(res.status).toBe(401)
      expect(edgeErrorResponseSchema.parse(await res.json())).toEqual({ error: 'Unauthorized' })
      // No LiteLLM key minted or looked up (anonymous or otherwise), and no
      // GitHub, Tavily, or MCP request either.
      expect(outbound).toEqual([])
      // Still CORS-readable, so the embedding host can show its sign-in CTA.
      expect(res.headers.get('access-control-allow-origin')).toBe(REQUIRED_ORIGIN)
    }
  )

  it.each(ROUTES)(
    '%s: a required origin with an invalid GitHub token gets 401 before any LiteLLM call',
    async (_label, call) => {
      const outbound = stubOutbound()

      const res = await send(call, { origin: REQUIRED_ORIGIN, authorization: 'Bearer revoked' })

      expect(res.status).toBe(401)
      expect(outbound.every((url) => url.startsWith('https://api.github.com/'))).toBe(true)
    }
  )

  it('applies to every listed origin, e.g. the develop edge’s localhost:5173', async () => {
    const outbound = stubOutbound()

    const res = await send(ROUTES[0]![1], { origin: 'http://localhost:5173' })

    expect(res.status).toBe(401)
    expect(outbound).toEqual([])
  })

  it.each([
    ['an unlisted origin', OTHER_ORIGIN],
    ['a request without Origin', undefined]
  ])('keeps the anonymous models path for %s', async (_label, origin) => {
    const outbound = stubOutbound()

    const res = await send(ROUTES[1]![1], origin ? { origin } : {})

    // Reached LiteLLM through the shared anonymous key (the stubbed upstream
    // chat endpoint answers 503) instead of being stopped at auth.
    expect(res.status).toBe(503)
    expect(outbound.some((url) => new URL(url).pathname === '/v2/key/info')).toBe(true)
  })

  it('does not interfere with CORS preflight from a required origin', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'OPTIONS',
        headers: { origin: REQUIRED_ORIGIN, 'access-control-request-method': 'POST' }
      }),
      ENV
    )

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(REQUIRED_ORIGIN)
  })
})
