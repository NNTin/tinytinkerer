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
      ...(options?.stream !== undefined ? { stream: options.stream } : {})
    }
    return fetchWithTelemetry(metadata, init)
  }
