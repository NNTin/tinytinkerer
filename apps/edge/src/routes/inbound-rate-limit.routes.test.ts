import { afterEach, describe, expect, it, vi } from 'vitest'
import { edgeErrorResponseSchema } from '@tinytinkerer/contracts'
import app from '../index.js'
import { clearInboundRateLimits } from '../lib/inbound-rate-limit.js'

// Route-level coverage for lib/inbound-rate-limit.ts: the middleware is wired
// ahead of the auth, search, and MCP handlers in index.ts. Limits are
// overridden via env bindings so each test stays short; the handlers
// themselves answer with their usual not-configured/unauthorized statuses
// (501/503/401) while the caller is under the limit — anything but 429.

const authExchange = (env: Record<string, string>, ip = '203.0.113.1') =>
  app.fetch(
    new Request('http://localhost/auth/github/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({
        code: 'abcdefghij0123456789',
        redirectUri: 'http://localhost:3111/callback'
      })
    }),
    env
  )

const search = (env: Record<string, string>, authorization?: string) =>
  app.fetch(
    new Request('http://localhost/api/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {})
      },
      body: JSON.stringify({ query: 'latest ai news' })
    }),
    env
  )

const mcp = (
  env: Record<string, string>,
  path: '/api/mcp/discover' | '/api/mcp/call',
  ip = '203.0.113.1'
) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({
        url: 'https://mcp.example.com/mcp',
        ...(path === '/api/mcp/call' ? { toolName: 't', arguments: {} } : {})
      })
    }),
    env
  )

describe('inbound rate limiting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    // The fixed windows are module-level (per-isolate); reset them so one
    // test's exhausted budget never bleeds into the next.
    clearInboundRateLimits()
  })

  it('returns 429 with a Retry-After header once the auth exchange limit is hit', async () => {
    const env = { RATE_LIMIT_AUTH_MAX: '2' }

    // Under the limit the handler answers normally (501: OAuth unconfigured).
    expect((await authExchange(env)).status).toBe(501)
    expect((await authExchange(env)).status).toBe(501)

    const limited = await authExchange(env)
    expect(limited.status).toBe(429)
    const retryAfter = limited.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect(Number(retryAfter)).toBeLessThanOrEqual(60)
    expect(edgeErrorResponseSchema.parse(await limited.json())).toEqual({
      error: 'Too many requests'
    })
  })

  it('keys the unauthenticated auth exchange per client IP', async () => {
    const env = { RATE_LIMIT_AUTH_MAX: '1' }

    expect((await authExchange(env, '203.0.113.1')).status).toBe(501)
    expect((await authExchange(env, '203.0.113.1')).status).toBe(429)
    // A different client keeps its own budget.
    expect((await authExchange(env, '198.51.100.7')).status).toBe(501)
  })

  it('keys the search route per credential', async () => {
    const env = { RATE_LIMIT_SEARCH_MAX: '1' }

    // Under the limit the handler answers normally (503: Tavily unconfigured).
    expect((await search(env, 'Bearer token-a')).status).toBe(503)
    expect((await search(env, 'Bearer token-a')).status).toBe(429)
    expect((await search(env, 'Bearer token-b')).status).toBe(503)
  })

  it('shares one MCP budget across discover and call', async () => {
    const env = { RATE_LIMIT_MCP_MAX: '1' }

    // Under the limit the handler answers normally (401: no Authorization).
    expect((await mcp(env, '/api/mcp/discover')).status).toBe(401)
    // The second MCP request — even to the other route — is throttled.
    expect((await mcp(env, '/api/mcp/call')).status).toBe(429)
  })

  it('honours the configurable window in the Retry-After header', async () => {
    const env = {
      RATE_LIMIT_AUTH_MAX: '1',
      RATE_LIMIT_WINDOW_SECONDS: '120'
    }

    expect((await authExchange(env)).status).toBe(501)
    const limited = await authExchange(env)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('120')
  })

  it('disables a scope when its limit binding is "0"', async () => {
    const env = { RATE_LIMIT_AUTH_MAX: '0' }
    for (let i = 0; i < 15; i++) {
      expect((await authExchange(env)).status).toBe(501)
    }
  })

  it('leaves CORS preflights out of the budget', async () => {
    const env = { RATE_LIMIT_AUTH_MAX: '1' }
    for (let i = 0; i < 3; i++) {
      const preflight = await app.fetch(
        new Request('http://localhost/auth/github/exchange', {
          method: 'OPTIONS',
          headers: {
            origin: 'http://localhost:3111',
            'cf-connecting-ip': '203.0.113.1'
          }
        }),
        env
      )
      expect(preflight.status).not.toBe(429)
    }
    // The real request still has its full budget.
    expect((await authExchange(env)).status).toBe(501)
  })
})
