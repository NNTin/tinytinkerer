import {
  fetchWithTelemetry,
  type RequestTelemetryMetadata
} from '@tinytinkerer/sentry-telemetry'

/**
 * Outbound fetch with a timeout, instrumented via the shared
 * {@link fetchWithTelemetry} so upstream 4xx/5xx and network failures are
 * captured in Sentry (the edge sink is registered in ./sentry). The timeout is
 * composed with any caller-supplied signal and torn down once the request
 * settles.
 */
export const fetchWithTimeout = (
  metadata: RequestTelemetryMetadata,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([controller.signal, init.signal])
    : controller.signal
  return fetchWithTelemetry(metadata, { ...init, signal }).finally(() => clearTimeout(timeoutId))
}
