import * as Sentry from '@sentry/cloudflare'
import type { MiddlewareHandler } from 'hono'
import { TELEMETRY_HEADERS } from '@tinytinkerer/contracts'
import type { Bindings } from './bindings'

/**
 * Reads the client telemetry headers and attaches them to the active Sentry
 * scope so edge errors are correlated with the app version, build, and the
 * pseudonymous install/GitHub identity (only present when the client opted in).
 */
export const telemetryMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const appVersion = c.req.header(TELEMETRY_HEADERS.appVersion)
  const buildHash = c.req.header(TELEMETRY_HEADERS.buildHash)
  const installId = c.req.header(TELEMETRY_HEADERS.installId)
  const licenseId = c.req.header(TELEMETRY_HEADERS.licenseId)

  if (appVersion) {
    Sentry.setTag('app_version', appVersion)
  }
  if (buildHash) {
    Sentry.setTag('build_hash', buildHash)
  }
  if (installId) {
    Sentry.setUser({ id: installId, ...(licenseId ? { username: licenseId } : {}) })
  }
  if (licenseId) {
    Sentry.setTag('github', licenseId)
  }

  await next()
}
