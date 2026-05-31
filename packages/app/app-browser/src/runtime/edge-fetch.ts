import { getTelemetryHeaders } from '../telemetry/telemetry'
import { fetchWithTelemetry, type RequestTelemetryMetadata } from '../telemetry/request-telemetry'

export type EdgeFetchOptions = {
  signal?: AbortSignal
  area?: string
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
      ...(options?.stream !== undefined ? { stream: options.stream } : {}),
      // Every edgeFetch is a cancellable model/agent call: the runtime aborts a
      // step on its idle timeout and the user can cancel an in-flight run. An
      // AbortError here is intentional control flow, never a bug
      // (TINYTINKERER-FRONTEND-A).
      accept: {
        kinds: ['abort'],
        reason:
          'ReAct decision/plan calls are aborted by the runtime step-timeout or a user cancel; AbortError is expected (TINYTINKERER-FRONTEND-A).'
      }
    }
    return fetchWithTelemetry(metadata, init)
  }
