// Where the SDK-agnostic capture contract meets a real Sentry scope. Shared by
// the browser (`@sentry/react`) and edge (`@sentry/cloudflare`) sinks, which
// each call this once they have a live `Scope` from their own SDK's
// `withScope`. The `@sentry/core` `Scope` type is the base both SDK scopes
// satisfy and is erased at build time, so this module carries no Sentry
// runtime dependency.

import type { Scope } from '@sentry/core'
import type { TelemetryCaptureOptions } from './capture'

/**
 * Applies the SDK-agnostic capture options (level, tags, contexts,
 * fingerprint) onto a Sentry scope. Shared by the exception and message
 * dispatchers in both runtimes.
 */
export const applyCaptureOptionsToScope = (
  scope: Scope,
  options: TelemetryCaptureOptions
): void => {
  if (options.level) {
    scope.setLevel(options.level)
  }
  if (options.tags) {
    for (const [key, value] of Object.entries(options.tags)) {
      if (value !== undefined) {
        scope.setTag(key, String(value))
      }
    }
  }
  if (options.contexts) {
    for (const [key, value] of Object.entries(options.contexts)) {
      scope.setContext(key, value)
    }
  }
  if (options.fingerprint) {
    scope.setFingerprint(options.fingerprint)
  }
}
