import type { MiddlewareHandler } from 'hono'
import { edgeErrorResponseSchema } from '@tinytinkerer/contracts'
import type { Bindings } from './bindings'
import { matchesAnyConfiguredOrigin, parseOriginList } from './cors'

/**
 * True when the request's `Origin` is listed in REQUIRE_AUTH_ORIGINS (same
 * exact / `https://*.` wildcard rules as ALLOWED_ORIGINS). Requests without an
 * Origin header never match.
 */
const originRequiresSignIn = (env: Bindings, requestOrigin: string | null): boolean => {
  if (!requestOrigin) return false
  const required = parseOriginList(env.REQUIRE_AUTH_ORIGINS)
  return required.length > 0 && matchesAnyConfiguredOrigin(required, requestOrigin)
}

/**
 * Per-origin sign-in policy (issue #510 T3). Mounted on the models, search and
 * MCP routes: a request from a REQUIRE_AUTH_ORIGINS origin that carries no
 * Authorization header is rejected with 401 here, before the route runs, so it
 * can never reach the models routes' shared anonymous LiteLLM key and no key
 * is minted or looked up. A request that does carry a token continues to the
 * route, which validates it against GitHub exactly as for any other origin (an
 * invalid token is still a 401 there, again before any LiteLLM key is used).
 *
 * This is a browser-origin policy, not an authentication boundary: a
 * non-browser client can omit or forge `Origin`. It exists so an embedding
 * host that must not offer anonymous use (CanFactory) never silently falls
 * back to it. Origins not listed keep today's behaviour.
 */
export const requireAuthForOrigin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (c.req.method !== 'OPTIONS' && originRequiresSignIn(c.env, c.req.header('origin') ?? null)) {
    const authorization = c.req.header('authorization')
    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }
  }

  await next()
}
