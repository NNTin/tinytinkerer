import type { OpenAPIHono } from '@hono/zod-openapi'
import { githubExchangeResponseSchema, type GitHubExchangeResponse } from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { Context, TypedResponse } from 'hono'
import type { Bindings } from '../lib/bindings'
import { fetchWithTimeout } from '../lib/fetch'
import { safeJsonParse } from '../lib/json'
import { authExchangeRoute } from '../openapi/routes'

const githubOAuthResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional()
})

const GITHUB_CODE_RE = /^[a-zA-Z0-9_-]{10,40}$/

// Typed 502 for a GitHub exchange that failed without a usable OAuth payload —
// a network failure/timeout, a non-JSON body (e.g. the HTML error page a proxy
// serves during a GitHub incident, issue #337), or JSON that is not an object.
// There is no app.onError, so an unhandled throw would become an unstructured
// framework 500 and break the client's typed githubExchangeResponseSchema
// error contract; every upstream misbehaviour must land here instead.
const oauthUpstreamFailure = (
  c: Context<{ Bindings: Bindings }>
): TypedResponse<GitHubExchangeResponse, 502, 'json'> =>
  c.json(githubExchangeResponseSchema.parse({ error: 'OAuth exchange failed' }), 502)

export const registerAuthRoutes = (app: OpenAPIHono<{ Bindings: Bindings }>) => {
  app.openapi(authExchangeRoute, async (c) => {
    const { code, redirectUri } = c.req.valid('json')

    if (!GITHUB_CODE_RE.test(code)) {
      return c.json(
        githubExchangeResponseSchema.parse({
          error: 'Invalid OAuth code format'
        }),
        400
      )
    }

    if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
      return c.json(
        githubExchangeResponseSchema.parse({
          error: 'OAuth is not configured'
        }),
        501
      )
    }

    // The fetch and the body read can both throw (network failure, the 10s
    // timeout aborting, a truncated stream) — all of them are "upstream
    // failed", never a framework 500.
    let response: Response
    let rawText: string
    try {
      response = await fetchWithTimeout(
        {
          area: 'auth.exchange',
          origin: 'github',
          method: 'POST',
          url: 'https://github.com/login/oauth/access_token'
        },
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            client_id: c.env.GITHUB_CLIENT_ID,
            client_secret: c.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri
          })
        },
        10_000
      )
      rawText = await response.text()
    } catch {
      return oauthUpstreamFailure(c)
    }

    // Guard the body parse exactly like the models routes: a non-JSON or
    // non-object body (proxy error page, issue #337) is a typed 502.
    const json = safeJsonParse(rawText)
    if (!json.ok) return oauthUpstreamFailure(c)
    const parsed = githubOAuthResponseSchema.safeParse(json.value)
    if (!parsed.success) return oauthUpstreamFailure(c)
    const payload = parsed.data

    // GitHub explicitly reported an OAuth error (e.g. bad_verification_code) —
    // surface it as a 400 regardless of the upstream HTTP status (existing
    // contract, preserved).
    if (payload.error) {
      return c.json(githubExchangeResponseSchema.parse({ error: payload.error }), 400)
    }

    // Upstream failed without a usable OAuth error payload (e.g. a proxy 502
    // that happens to be JSON).
    if (!response.ok) return oauthUpstreamFailure(c)

    // A 200 JSON body missing both fields (existing contract, preserved).
    if (!payload.access_token) {
      return c.json(githubExchangeResponseSchema.parse({ error: 'OAuth exchange failed' }), 400)
    }

    return c.json(githubExchangeResponseSchema.parse({ accessToken: payload.access_token }), 200)
  })
}
