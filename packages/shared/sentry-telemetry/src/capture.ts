// SDK-agnostic capture sink. The request-telemetry engine dispatches captured
// issues through `captureTelemetryException`, but the actual Sentry call is
// injected by each runtime: the browser registers an `@sentry/react` sink, the
// edge an `@sentry/cloudflare` sink. This keeps this package free of any Sentry
// SDK runtime dependency. See docs/sentry-telemetry.md.

export type TelemetryLevel = 'warning' | 'error'

export type TelemetryCaptureOptions = {
  level?: TelemetryLevel
  tags?: Record<string, string | number | boolean | undefined>
  contexts?: Record<string, Record<string, unknown>>
}

export type CaptureExceptionSink = (error: Error, options: TelemetryCaptureOptions) => void

let sink: CaptureExceptionSink | null = null

/**
 * Registers (or clears, with `null`) the runtime's Sentry sink. Called once by
 * each app after it initializes its SDK; cleared on teardown (e.g. consent off).
 */
export const setCaptureExceptionSink = (fn: CaptureExceptionSink | null): void => {
  sink = fn
}

/**
 * Dispatches a telemetry exception to the registered sink. No-ops when no sink
 * is registered, so telemetry never breaks a runtime that hasn't opted in.
 */
export const captureTelemetryException = (
  error: unknown,
  options: TelemetryCaptureOptions = {}
): void => {
  if (!sink) {
    return
  }
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unknown telemetry error')
  sink(normalized, options)
}
