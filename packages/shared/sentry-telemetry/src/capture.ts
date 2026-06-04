// SDK-agnostic capture sink. The request-telemetry engine dispatches captured
// issues through `captureTelemetryException`, but the actual Sentry call is
// injected by each runtime: the browser registers an `@sentry/react` sink, the
// edge an `@sentry/cloudflare` sink. This keeps this package free of any Sentry
// SDK runtime dependency. See docs/sentry-telemetry.md.

export type TelemetryLevel = 'info' | 'warning' | 'error'

export type TelemetryCaptureOptions = {
  level?: TelemetryLevel
  tags?: Record<string, string | number | boolean | undefined>
  contexts?: Record<string, Record<string, unknown>>
  /**
   * Grouping override. Every request failure shares the same `normalizeError`
   * frame, so without this Sentry collapses unrelated endpoints/statuses into
   * one issue (e.g. `models.list` 429 and `models.chat` 429 conflated). Setting
   * a per-(area+kind+status) fingerprint keeps each failure its own issue.
   */
  fingerprint?: string[]
}

export type CaptureExceptionSink = (error: Error, options: TelemetryCaptureOptions) => void

// A message sink reports a plain informational/diagnostic message rather than an
// exception. The browser wires this to Sentry's `captureMessage`, which files the
// event as a *message* (e.g. an `info`-level entry) instead of an *error issue*
// with a synthetic stack trace. Used for non-error telemetry like user feedback.
export type CaptureMessageSink = (message: string, options: TelemetryCaptureOptions) => void

let sink: CaptureExceptionSink | null = null
let messageSink: CaptureMessageSink | null = null

/**
 * Registers (or clears, with `null`) the runtime's Sentry sink. Called once by
 * each app after it initializes its SDK; cleared on teardown (e.g. consent off).
 */
export const setCaptureExceptionSink = (fn: CaptureExceptionSink | null): void => {
  sink = fn
}

/**
 * Registers (or clears, with `null`) the runtime's Sentry *message* sink. Like
 * the exception sink, each app wires this after initializing its SDK and clears
 * it on teardown. A runtime that registers nothing simply drops messages.
 */
export const setCaptureMessageSink = (fn: CaptureMessageSink | null): void => {
  messageSink = fn
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

/**
 * Dispatches a telemetry *message* to the registered message sink. Use this for
 * non-error telemetry (e.g. feedback) so it surfaces as an informational message
 * rather than an error issue. No-ops when no message sink is registered.
 */
export const captureTelemetryMessage = (
  message: string,
  options: TelemetryCaptureOptions = {}
): void => {
  if (!messageSink) {
    return
  }
  messageSink(message, options)
}
