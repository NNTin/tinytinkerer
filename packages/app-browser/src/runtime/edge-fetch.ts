export type EdgeFetch = (path: string, body: unknown) => Promise<Response>

export const createEdgeFetch = (
  baseUrl: string,
  getToken: () => string | null | undefined
): EdgeFetch =>
  async function edgeFetch(path, body) {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  }
