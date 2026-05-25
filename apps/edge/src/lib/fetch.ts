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
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(timeoutId))
}
