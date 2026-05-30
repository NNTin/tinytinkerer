export const fetchWithTimeout = (
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([controller.signal, init.signal])
    : controller.signal
  // eslint-disable-next-line no-restricted-globals -- low-level timeout wrapper on the edge runtime, which cannot import the app-browser fetchWithTelemetry (it pulls in browser-only Sentry telemetry and is forbidden by the package boundary rules).
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(timeoutId))
}
