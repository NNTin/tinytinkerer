import { getTelemetryHeaders } from '../telemetry/telemetry'

export type EdgeFetch = (path: string, body: unknown, signal?: AbortSignal) => Promise<Response>

export const createEdgeFetch = (
  baseUrl: string,
  getToken: () => string | null | undefined
): EdgeFetch =>
  async function edgeFetch(path, body, signal) {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...getTelemetryHeaders()
    }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal) {
      init.signal = signal
    }
    return fetch(`${baseUrl}${path}`, init)
  }
