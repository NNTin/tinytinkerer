import * as Sentry from '@sentry/cloudflare'
import {
  applyCaptureOptionsToScope,
  setCaptureExceptionSink,
  setCaptureMessageSink,
  type TelemetryCaptureOptions
} from '@tinytinkerer/sentry-telemetry'

// Edge capture sink for the shared request-telemetry engine. Maps the
// SDK-agnostic capture options onto a @sentry/cloudflare scope. Registered at
// module load (imported for side effect by index.ts); no-ops when Sentry is not
// configured (no DSN), since captureException is then inert.
const dispatchToSentry = (error: Error, options: TelemetryCaptureOptions): void => {
  Sentry.withScope((scope) => {
    applyCaptureOptionsToScope(scope, options)
    Sentry.captureException(error)
  })
}

// Message sink: non-error diagnostics (e.g. a LiteLLM key-value mismatch in
// litellm-user-keys.ts) surface as Sentry *messages* at their given level rather
// than synthetic error issues. Without this the shared `captureTelemetryMessage`
// no-ops on the edge. (The old provider-missing default warning that this once
// exemplified was retired with the LiteLLM-sole-provider migration in 6bae243.)
const dispatchMessageToSentry = (message: string, options: TelemetryCaptureOptions): void => {
  Sentry.withScope((scope) => {
    applyCaptureOptionsToScope(scope, options)
    Sentry.captureMessage(message, options.level ?? 'info')
  })
}

setCaptureExceptionSink(dispatchToSentry)
setCaptureMessageSink(dispatchMessageToSentry)
