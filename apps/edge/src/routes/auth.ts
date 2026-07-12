import type { OpenAPIHono } from '@hono/zod-openapi'
import { githubExchangeResponseSchema, type GitHubExchangeResponse } from '@tinytinkerer/contracts'
import { captureTelemetryException } from '@tinytinkerer/sentry-telemetry'
import { z } from 'zod'
import type { Context, TypedResponse } from 'hono'
import type { Bindings } from '../lib/bindings'
import { fetchWithTimeout } from '../lib/fetch'
import { safeJsonParse } from '../lib/json'
import { authExchangeRoute } from '../openapi/routes'

const githubOAuthResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  // GitHub pairs `error` with a human-readable description and a docs link. Both
  // are safe to surface in telemetry (they never echo the client secret, auth
  // code, or an access token) and turn an opaque `error` code into an
  // actionable Sentry event. Kept out of the client response to preserve the
  // existing githubExchangeResponseSchema contract.
  error_description: z.string().optional()
})

const GITHUB_CODE_RE = /^[a-zA-Z0-9_-]{10,40}$/

// Sentry capture for a GitHub OAuth token-exchange failure. GitHub reports OAuth
// errors (`incorrect_client_credentials`, `bad_verification_code`,
// `redirect_uri_mismatch`) with an HTTP **200** body, so the shared
// `fetchWithTelemetry` http_error hook — which only fires on `!response.ok` —
// never sees them; the failure was returned to the client and silently dropped,
// leaving login breakages undebuggable (issue #409). Capture them here with the
// OAuth step, the provider error code/description, and the upstream HTTP status.
// NEVER include the authorization code, client secret, or access token — none of
// those values reach this function, and `error`/`error_description` are the only
// upstream fields passed through.
const captureOAuthExchangeFailure = (details: {
  reason: string
  providerErrorCode?: string
  providerErrorDescription?: string
  httpStatus: number
}): void => {
  captureTelemetryException(new Error(`GitHub OAuth exchange failed: ${details.reason}`), {
    level: 'error',
    tags: {
      source: 'oauth',
      oauth_step: 'github_token_exchange',
      http_status: details.httpStatus,
      ...(details.providerErrorCode ? { oauth_error: details.providerErrorCode } : {})
    },
    contexts: {
      oauth: {
        step: 'github_token_exchange',
        reason: details.reason,
        http_status: details.httpStatus,
        ...(details.providerErrorCode ? { error_code: details.providerErrorCode } : {}),
        ...(details.providerErrorDescription
          ? { error_description: details.providerErrorDescription }
          : {})
      }
    },
    // Group by the distinguishing provider error code so a dead secret
    // (`incorrect_client_credentials`) never conflates with an expired code
    // (`bad_verification_code`) in one Sentry issue.
    fingerprint: ['oauth-exchange', details.providerErrorCode ?? details.reason]
  })
}

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
    // non-object body (proxy error page, issue #337) is a typed 502. A non-ok
    // status was already captured by `fetchWithTelemetry` (http_error); only a
    // 200 with an unusable body slips past it, so capture that case here.
    const json = safeJsonParse(rawText)
    if (!json.ok) {
      if (response.ok) {
        captureOAuthExchangeFailure({
          reason: 'non_json_upstream_body',
          httpStatus: response.status
        })
      }
      return oauthUpstreamFailure(c)
    }
    const parsed = githubOAuthResponseSchema.safeParse(json.value)
    if (!parsed.success) {
      if (response.ok) {
        captureOAuthExchangeFailure({
          reason: 'unexpected_upstream_shape',
          httpStatus: response.status
        })
      }
      return oauthUpstreamFailure(c)
    }
    const payload = parsed.data

    // GitHub explicitly reported an OAuth error (e.g. bad_verification_code,
    // incorrect_client_credentials) — surface it as a 400 regardless of the
    // upstream HTTP status (existing contract, preserved). This is the primary
    // login-failure signal and, because GitHub returns it with HTTP 200, the one
    // `fetchWithTelemetry` cannot see, so capture it explicitly here.
    if (payload.error) {
      captureOAuthExchangeFailure({
        reason: 'github_oauth_error',
        providerErrorCode: payload.error,
        ...(payload.error_description
          ? { providerErrorDescription: payload.error_description }
          : {}),
        httpStatus: response.status
      })
      return c.json(githubExchangeResponseSchema.parse({ error: payload.error }), 400)
    }

    // Upstream failed without a usable OAuth error payload (e.g. a proxy 502
    // that happens to be JSON). `fetchWithTelemetry` already captured the non-ok
    // status as an http_error, so no second capture here.
    if (!response.ok) return oauthUpstreamFailure(c)

    // A 200 JSON body missing both fields (existing contract, preserved). Invisible
    // to the http_error hook (200 ok), so capture it explicitly.
    if (!payload.access_token) {
      captureOAuthExchangeFailure({
        reason: 'missing_access_token',
        httpStatus: response.status
      })
      return c.json(githubExchangeResponseSchema.parse({ error: 'OAuth exchange failed' }), 400)
    }

    return c.json(githubExchangeResponseSchema.parse({ accessToken: payload.access_token }), 200)
  })
}
