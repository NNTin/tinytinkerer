import { githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import { getBrowserShellConfig } from './shell'

const OAUTH_STATE_KEY = 'oauth_state'

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export const buildGitHubLoginUrl = (): string | null => {
  const config = getBrowserShellConfig()
  if (config.authMode === 'host-token') {
    return null
  }

  if (!config.githubClientId) {
    return null
  }

  const state = generateState()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: config.githubClientId,
    scope: 'read:user',
    state
  })

  if (config.githubRedirectUri) {
    params.set('redirect_uri', config.githubRedirectUri)
  }

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const validateOAuthState = (returnedState: string | null): boolean => {
  const storedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  return Boolean(storedState) && storedState === returnedState
}

export const exchangeCode = async (code: string): Promise<string> => {
  const config = getBrowserShellConfig()
  const response = await fetch(`${config.edgeBaseUrl}/auth/github/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      ...(config.githubRedirectUri ? { redirectUri: config.githubRedirectUri } : {})
    })
  })

  if (!response.ok) {
    throw new Error('OAuth exchange failed')
  }

  const data = githubExchangeResponseSchema.parse(await response.json())
  if (!data.accessToken) {
    throw new Error('Authentication failed')
  }

  return data.accessToken
}
