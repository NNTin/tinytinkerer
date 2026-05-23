import { githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import { getBrowserShellConfig } from './shell'
import { useAuthStore } from './stores/auth-store'

const oauthStateKey = (): string => `${getBrowserShellConfig().storageNamespace}:oauth_state`

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export const canStartGitHubOAuth = (): boolean => {
  const config = getBrowserShellConfig()
  return config.authMode !== 'host-token' && Boolean(config.githubClientId)
}

const createGitHubLoginUrl = (): string => {
  if (!canStartGitHubOAuth()) {
    throw new Error('GitHub OAuth is not available for this browser shell.')
  }

  const config = getBrowserShellConfig()
  const state = generateState()
  sessionStorage.setItem(oauthStateKey(), state)
  const params = new URLSearchParams({
    client_id: config.githubClientId!,
    scope: 'read:user',
    state
  })

  if (config.githubRedirectUri) {
    params.set('redirect_uri', config.githubRedirectUri)
  }

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export const startGitHubOAuth = (): void => {
  window.location.assign(createGitHubLoginUrl())
}

const validateOAuthState = (returnedState: string | null): boolean => {
  const stateKey = oauthStateKey()
  const storedState = sessionStorage.getItem(stateKey)
  sessionStorage.removeItem(stateKey)
  return Boolean(storedState) && storedState === returnedState
}

const exchangeCode = async (code: string): Promise<string> => {
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
    const parsedPayload = await response
      .clone()
      .json()
      .then((value) => githubExchangeResponseSchema.safeParse(value))
      .catch(() => undefined)

    throw new Error(
      parsedPayload?.success ? (parsedPayload.data.error ?? 'OAuth exchange failed') : 'OAuth exchange failed'
    )
  }

  const data = githubExchangeResponseSchema.parse(await response.json())
  if (!data.accessToken) {
    throw new Error('Authentication failed')
  }

  return data.accessToken
}

export const completeGitHubOAuthCallback = async (options: {
  code: string | null
  state: string | null
}): Promise<void> => {
  if (!options.code) {
    throw new Error('No authorization code received from GitHub.')
  }

  if (!validateOAuthState(options.state)) {
    throw new Error('Authentication failed. Please try signing in again.')
  }

  try {
    const token = await exchangeCode(options.code)
    await useAuthStore.getState().setToken(token)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message || 'Authentication failed. Please try again.')
    }

    throw new Error('Authentication failed. Please try again.')
  }
}
