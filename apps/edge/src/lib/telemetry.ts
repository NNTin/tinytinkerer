import * as Sentry from '@sentry/cloudflare'
import type { MiddlewareHandler } from 'hono'
import { TELEMETRY_HEADERS, telemetryHeadersSchema } from '@tinytinkerer/contracts'
import type { Bindings } from './bindings'

/**
 * Reads the client telemetry headers and attaches them to the active Sentry
 * scope so edge errors are correlated with the app version, build, and the
 * pseudonymous install/GitHub identity (only present when the client opted in).
 *
 * Header values are client-supplied, so they are validated (and length-bounded)
 * via {@link telemetryHeadersSchema} before they reach Sentry; oversized or
 * malformed values are dropped rather than trusted.
 */
export const telemetryMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const parsed = telemetryHeadersSchema.safeParse({
    appVersion: c.req.header(TELEMETRY_HEADERS.appVersion),
    buildHash: c.req.header(TELEMETRY_HEADERS.buildHash),
    installId: c.req.header(TELEMETRY_HEADERS.installId),
    githubId: c.req.header(TELEMETRY_HEADERS.githubId)
  })

  if (parsed.success) {
    const { appVersion, buildHash, installId, githubId } = parsed.data

    if (appVersion) {
      Sentry.setTag('app_version', appVersion)
    }
    if (buildHash) {
      Sentry.setTag('build_hash', buildHash)
    }
    if (installId) {
      Sentry.setUser({ id: installId, ...(githubId ? { username: githubId } : {}) })
    }
    if (githubId) {
      Sentry.setTag('github', githubId)
    }
  }

  await next()
}
