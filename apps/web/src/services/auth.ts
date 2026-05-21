import { z } from 'zod'

const OAUTH_STATE_KEY = 'oauth_state'
const edgeUrl = import.meta.env.VITE_EDGE_URL ?? 'http://127.0.0.1:8787'

const exchangeResponseSchema = z.object({
  accessToken: z.string().optional(),
  error: z.string().optional()
})

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const buildGitHubLoginUrl = (): string | null => {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  if (!clientId) return null

  const state = generateState()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({ client_id: clientId, scope: 'read:user', state })
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  if (redirectUri) params.set('redirect_uri', redirectUri)

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const validateOAuthState = (returnedState: string | null): boolean => {
  const storedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  return Boolean(storedState) && storedState === returnedState
}

export const exchangeCode = async (code: string): Promise<string> => {
  const redirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI
  const response = await fetch(`${edgeUrl}/auth/github/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...(redirectUri ? { redirectUri } : {}) })
  })

  if (!response.ok) {
    throw new Error('OAuth exchange failed')
  }

  const data = exchangeResponseSchema.parse(await response.json())
  if (!data.accessToken) {
    throw new Error('Authentication failed')
  }

  return data.accessToken
}
