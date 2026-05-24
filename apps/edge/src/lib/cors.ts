import type { MiddlewareHandler } from 'hono'
import type { Bindings } from './bindings'

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

const getConfiguredOrigins = (env: Bindings): string[] => {
  const allowlist = env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  if (allowlist && allowlist.length > 0) {
    return allowlist
  }

  return env.ALLOWED_ORIGIN ? [env.ALLOWED_ORIGIN] : []
}

export const resolveAllowedOrigin = (
  env: Bindings,
  requestOrigin: string | null
): string | null => {
  const configuredOrigins = getConfiguredOrigins(env)

  if (configuredOrigins.length === 0) {
    return '*'
  }

  if (!requestOrigin) {
    return null
  }

  return configuredOrigins.some((configuredOrigin) =>
    matchesConfiguredOrigin(configuredOrigin, requestOrigin)
  )
    ? requestOrigin
    : null
}

const EXPOSED_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-renewalperiod-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
  'x-ratelimit-renewalperiod-tokens',
  'x-ratelimit-abusepenalty-active',
].join(', ')

export const applyCorsHeaders = (
  headers: Headers,
  env: Bindings,
  requestOrigin: string | null
): void => {
  const allowedOrigin = resolveAllowedOrigin(env, requestOrigin)

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin)
  }

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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
