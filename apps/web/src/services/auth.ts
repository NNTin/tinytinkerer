const edgeUrl = import.meta.env.VITE_EDGE_URL ?? 'http://127.0.0.1:8787'

export const buildGitHubLoginUrl = (): string | null => {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  if (!clientId) return null

  const params = new URLSearchParams({ client_id: clientId, scope: 'read:user' })
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  if (redirectUri) params.set('redirect_uri', redirectUri)

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const exchangeCode = async (code: string): Promise<string> => {
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI as string | undefined
  const response = await fetch(`${edgeUrl}/auth/github/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...(redirectUri ? { redirectUri } : {}) })
  })

  if (!response.ok) {
    throw new Error('OAuth exchange failed')
  }

  const data = (await response.json()) as { accessToken?: string; error?: string }
  if (!data.accessToken) {
    throw new Error(data.error ?? 'No access token in response')
  }

  return data.accessToken
}
