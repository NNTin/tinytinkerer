import * as Sentry from '@sentry/cloudflare'
import {
  setCaptureExceptionSink,
  type TelemetryCaptureOptions
} from '@tinytinkerer/sentry-telemetry'

// Edge capture sink for the shared request-telemetry engine. Maps the
// SDK-agnostic capture options onto a @sentry/cloudflare scope. Registered at
// module load (imported for side effect by index.ts); no-ops when Sentry is not
// configured (no DSN), since captureException is then inert.
const dispatchToSentry = (error: Error, options: TelemetryCaptureOptions): void => {
  Sentry.withScope((scope) => {
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
    Sentry.captureException(error)
  })
}

setCaptureExceptionSink(dispatchToSentry)
