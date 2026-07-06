import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import app from '../index.js'
import { clearInboundRateLimits } from '../lib/inbound-rate-limit.js'

// Route-level coverage for the edge's only auth endpoint,
// POST /auth/github/exchange (issues #337, #349). The single upstream — the
// GitHub token endpoint — is mocked at the global `fetch` boundary, so the
// whole handler runs for real: the code-format and configuration guards, the
// outbound exchange request, and the mapping of every upstream misbehaviour
// (OAuth error payloads, non-JSON proxy error pages, network failures) onto
// the typed githubExchangeResponseSchema contract instead of an unhandled
// framework 500.

const ENV = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret'
}

const VALID_CODE = 'abcdefghij0123456789'

const exchange = (env: Record<string, string>, code = VALID_CODE) =>
  app.fetch(
    new Request('http://localhost/auth/github/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: 'http://localhost:3111/callback' })
    }),
    env
  )

// fetchWithTimeout passes (url, init) today, but derive URL/method/headers/body
// from either calling convention so the assertions survive a refactor to a
// Request object (see toRequestUrl in mcp.test.ts).
const toRequestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const toRequestMethod = (input: RequestInfo | URL, init?: RequestInit): string | undefined =>
  init?.method ?? (input instanceof Request ? input.method : undefined)

const toRequestHeader = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  name: string
): string | null =>
  new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get(name)

const toRequestBodyJson = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<unknown> => {
  if (typeof init?.body === 'string') return JSON.parse(init.body)
  if (input instanceof Request) return input.clone().json()
  throw new Error('outbound request carried no readable JSON body')
}

type OutboundFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Stub `fetch` so the GitHub token endpoint answers with `body`/`status`. */
const stubGitHub = (body: string, status = 200, contentType = 'application/json') => {
  const stub = vi.fn<OutboundFetch>(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } }))
  )
  vi.stubGlobal('fetch', stub)
  return stub
}

/** Stub `fetch` to reject outright (network failure / DNS error). */
const stubGitHubNetworkFailure = () => {
  const stub = vi.fn<OutboundFetch>(() => Promise.reject(new TypeError('fetch failed')))
  vi.stubGlobal('fetch', stub)
  return stub
}

afterEach(() => {
  vi.unstubAllGlobals()
  // The auth exchange sits behind a per-isolate inbound rate limit (10/window
  // by default); reset it so one test's requests never eat the next's budget.
  clearInboundRateLimits()
})

describe('POST /auth/github/exchange', () => {
  it('exchanges a valid code for an access token and calls GitHub correctly', async () => {
    const stub = stubGitHub(JSON.stringify({ access_token: 'gho_test123' }))

    const res = await exchange(ENV)
    expect(res.status).toBe(200)
    expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
      accessToken: 'gho_test123'
    })

    // The outbound exchange request must carry the configured client
    // credentials, the code, and the redirect URI to the token endpoint.
    expect(stub).toHaveBeenCalledTimes(1)
    const call = stub.mock.calls[0]
    if (!call) throw new Error('expected an outbound GitHub request')
    const [input, init] = call
    expect(toRequestUrl(input)).toBe('https://github.com/login/oauth/access_token')
    expect(toRequestMethod(input, init)).toBe('POST')
    expect(toRequestHeader(input, init, 'accept')).toBe('application/json')
    expect(await toRequestBodyJson(input, init)).toMatchObject({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: VALID_CODE,
      redirect_uri: 'http://localhost:3111/callback'
    })
  })

  describe('code format gate (GITHUB_CODE_RE)', () => {
    it('rejects a too-short code without calling GitHub', async () => {
      const stub = stubGitHub('{}')
      const res = await exchange(ENV, 'short')
      expect(res.status).toBe(400)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'Invalid OAuth code format'
      })
      expect(stub).not.toHaveBeenCalled()
    })

    it('rejects a 20-char code with invalid characters', async () => {
      const stub = stubGitHub('{}')
      const res = await exchange(ENV, 'abc def!@#$%^&*()_+=')
      expect(res.status).toBe(400)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'Invalid OAuth code format'
      })
      expect(stub).not.toHaveBeenCalled()
    })
  })

  it('returns 501 when OAuth is not configured, without calling GitHub', async () => {
    const stub = stubGitHub('{}')
    const res = await exchange({})
    expect(res.status).toBe(501)
    expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
      error: 'OAuth is not configured'
    })
    expect(stub).not.toHaveBeenCalled()
  })

  describe('GitHub OAuth error payloads', () => {
    it('surfaces a 200-status OAuth error as a 400 with the GitHub error code', async () => {
      stubGitHub(JSON.stringify({ error: 'bad_verification_code' }))
      const res = await exchange(ENV)
      expect(res.status).toBe(400)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'bad_verification_code'
      })
    })

    it('surfaces a non-200 JSON OAuth error as a 400 with the GitHub error code', async () => {
      stubGitHub(JSON.stringify({ error: 'incorrect_client_credentials' }), 401)
      const res = await exchange(ENV)
      expect(res.status).toBe(400)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'incorrect_client_credentials'
      })
    })
  })

  describe('malformed upstream bodies (issue #337)', () => {
    it('returns a typed 502 for a non-JSON 200 body', async () => {
      stubGitHub('<html>ok</html>', 200, 'text/html')
      const res = await exchange(ENV)
      expect(res.status).toBe(502)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'OAuth exchange failed'
      })
    })

    it('returns a typed 502 for a non-JSON non-200 body', async () => {
      // The exact #337 incident scenario: a proxy in front of GitHub answers
      // the token exchange with an HTML 502 error page during an incident, and
      // the unguarded response.json() used to throw an unhandled framework 500.
      stubGitHub('<html><body>502 Bad Gateway</body></html>', 502, 'text/html')
      const res = await exchange(ENV)
      expect(res.status).toBe(502)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'OAuth exchange failed'
      })
    })

    it('returns a typed 502 for valid JSON with a non-object root', async () => {
      stubGitHub('"unexpected"')
      const res = await exchange(ENV)
      expect(res.status).toBe(502)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'OAuth exchange failed'
      })
    })
  })

  describe('JSON bodies missing the expected fields', () => {
    it('returns 400 for a 200 JSON body missing both access_token and error', async () => {
      stubGitHub('{}')
      const res = await exchange(ENV)
      expect(res.status).toBe(400)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'OAuth exchange failed'
      })
    })

    it('returns 502 for a non-200 JSON body without an OAuth error field', async () => {
      stubGitHub('{}', 500)
      const res = await exchange(ENV)
      expect(res.status).toBe(502)
      expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
        error: 'OAuth exchange failed'
      })
    })
  })

  it('returns a typed 502 when the fetch itself fails (network failure)', async () => {
    stubGitHubNetworkFailure()
    const res = await exchange(ENV)
    expect(res.status).toBe(502)
    expect(githubExchangeResponseSchema.parse(await res.json())).toEqual({
      error: 'OAuth exchange failed'
    })
  })
})
