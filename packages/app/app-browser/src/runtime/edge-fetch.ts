import { getTelemetryHeaders } from '../telemetry/telemetry'
import { fetchWithTelemetry, type RequestTelemetryMetadata } from '../telemetry/request-telemetry'

export type EdgeFetchOptions = {
  signal?: AbortSignal
  area?: string
  model?: string
  stream?: boolean
}

export type EdgeFetch = (path: string, body: unknown, options?: EdgeFetchOptions) => Promise<Response>

export const createEdgeFetch = (
  baseUrl: string,
  getToken: () => string | null | undefined
): EdgeFetch =>
  async function edgeFetch(path, body, options) {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...getTelemetryHeaders()
    }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }
    const url = `${baseUrl}${path}`
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (options?.signal) {
      init.signal = options.signal
    }
    const metadata: RequestTelemetryMetadata = {
      area: options?.area ?? path,
      origin: 'edge',
      method: 'POST',
      url,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.stream !== undefined ? { stream: options.stream } : {}),
      // Every edgeFetch is a cancellable model/agent call: the runtime aborts a
      // step on its idle timeout and the user can cancel an in-flight run, so an
      // AbortError is intentional control flow (TINYTINKERER-FRONTEND-A). A 429
      // is GitHub Models rate limiting the user's own prompts: the edge already
      // returns a clean 429/Retry-After and every consumer funnels it into a
      // RateLimitError → cooldown banner, so it is expected, handled, and
      // unavoidable — not a captured error (TINYTINKERER-FRONTEND-9).
      accept: {
        kinds: ['abort'],
        status: [429],
        reason:
          'AbortError = runtime step-timeout / user cancel (TINYTINKERER-FRONTEND-A); 429 = GitHub Models rate limit surfaced to the user as a cooldown via RateLimitError (TINYTINKERER-FRONTEND-9).'
      }
    }
    return fetchWithTelemetry(metadata, init)
  }
