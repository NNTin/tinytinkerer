import type { MiddlewareHandler } from 'hono'
import { EDGE_EXPOSED_HEADERS, EDGE_HEADER_NAMES, TELEMETRY_HEADERS } from '@tinytinkerer/contracts'
import type { Bindings } from './bindings'

// Derived from the shared contract so adding a telemetry header automatically
// keeps it CORS-allowed (no drift between the wire protocol and the allowlist).
const ALLOWED_REQUEST_HEADERS = [
  EDGE_HEADER_NAMES.contentType,
  EDGE_HEADER_NAMES.authorization,
  ...Object.values(TELEMETRY_HEADERS)
].join(', ')

const matchesConfiguredOrigin = (configuredOrigin: string, requestOrigin: string): boolean => {
  if (!configuredOrigin.includes('*')) {
    return configuredOrigin === requestOrigin
  }

  const wildcardPrefix = 'https://*.'
  if (!configuredOrigin.startsWith(wildcardPrefix)) {
    return false
  }

  let requestedUrl: URL
  try {
    requestedUrl = new URL(requestOrigin)
  } catch {
    return false
  }

  if (requestedUrl.protocol !== 'https:') {
    return false
  }

  const configuredHostSuffix = configuredOrigin.slice(wildcardPrefix.length)
  const requestHost = requestedUrl.hostname

  if (!requestHost.endsWith(`.${configuredHostSuffix}`)) {
    return false
  }

  const subdomain = requestHost.slice(0, -(configuredHostSuffix.length + 1))
  return subdomain.length > 0 && !subdomain.includes('.')
}

/**
 * Parse a comma-separated origin list (ALLOWED_ORIGINS, REQUIRE_AUTH_ORIGINS):
 * trimmed, empty entries dropped.
 */
export const parseOriginList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

/**
 * True when `requestOrigin` matches any entry of `configuredOrigins`, with the
 * same exact-match / single-label `https://*.` wildcard rules the CORS
 * allowlist uses.
 */
export const matchesAnyConfiguredOrigin = (
  configuredOrigins: readonly string[],
  requestOrigin: string
): boolean =>
  configuredOrigins.some((configuredOrigin) =>
    matchesConfiguredOrigin(configuredOrigin, requestOrigin)
  )

const getConfiguredOrigins = (env: Bindings): string[] => {
  const allowlist = parseOriginList(env.ALLOWED_ORIGINS)

  if (allowlist.length > 0) {
    return allowlist
  }

  return env.ALLOWED_ORIGIN ? [env.ALLOWED_ORIGIN] : []
}

const resolveAllowedOrigin = (env: Bindings, requestOrigin: string | null): string | null => {
  const configuredOrigins = getConfiguredOrigins(env)

  if (configuredOrigins.length === 0) {
    return env.ALLOW_ALL_ORIGINS === 'true' ? '*' : null
  }

  if (!requestOrigin) {
    return null
  }

  return matchesAnyConfiguredOrigin(configuredOrigins, requestOrigin) ? requestOrigin : null
}

/**
 * The CORS allowlist decision as a predicate: true when the edge would answer
 * `requestOrigin` with an `Access-Control-Allow-Origin` header (an
 * ALLOWED_ORIGINS match, or any origin under the dev-only ALLOW_ALL_ORIGINS).
 * Shared with the OAuth exchange's redirect-URI check so both use one matcher.
 */
export const isOriginAllowed = (env: Bindings, requestOrigin: string | null): boolean =>
  resolveAllowedOrigin(env, requestOrigin) !== null

// Generated from the OpenAPI source so the exposed set never drifts from the
// LiteLLM rate-limit headers the proxy actually forwards (plus retry-after).
const EXPOSED_HEADERS = [...EDGE_EXPOSED_HEADERS].join(', ')

export const applyCorsHeaders = (
  headers: Headers,
  env: Bindings,
  requestOrigin: string | null
): void => {
  const allowedOrigin = resolveAllowedOrigin(env, requestOrigin)

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin)
  }

  // Vary: Origin prevents caches from serving one origin's credentialed response to another.
  if (allowedOrigin !== '*' && headers.get('Vary') !== 'Origin') {
    headers.append('Vary', 'Origin')
  }

  headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS)
}

export const corsMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const requestOrigin = c.req.header('origin') ?? null

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers({
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
      'Access-Control-Max-Age': '86400'
    })

    applyCorsHeaders(headers, c.env, requestOrigin)

    return new Response(null, {
      status: 204,
      headers
    })
  }

  await next()
  applyCorsHeaders(c.res.headers, c.env, requestOrigin)
}
