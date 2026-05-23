import { z } from 'zod'

const OAUTH_STATE_KEY = 'oauth_state'

const exchangeResponseSchema = z.object({
  accessToken: z.string().optional(),
  error: z.string().optional()
})

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type OAuthConfig = {
  clientId?: string
  redirectUri?: string
}

export const buildGitHubLoginUrl = (config: OAuthConfig): string | null => {
  if (!config.clientId) return null

  const state = generateState()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({ client_id: config.clientId, scope: 'read:user', state })
  if (config.redirectUri) params.set('redirect_uri', config.redirectUri)

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const validateOAuthState = (returnedState: string | null): boolean => {
  const storedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  return Boolean(storedState) && storedState === returnedState
}

export const exchangeCode = async (
  code: string,
  config: { edgeBaseUrl: string; redirectUri?: string }
): Promise<string> => {
  const response = await fetch(`${config.edgeBaseUrl}/auth/github/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...(config.redirectUri ? { redirectUri: config.redirectUri } : {}) })
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
