import { githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import type { BrowserApp } from './app'
import type { BrowserShell } from './shell'

const oauthStateKey = (shell: BrowserShell): string => `${shell.config.storageNamespace}:oauth_state`

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export const canStartGitHubOAuth = (shell: BrowserShell): boolean => {
  const config = shell.config
  return config.authMode !== 'host-token' && Boolean(config.githubClientId)
}

const createGitHubLoginUrl = (shell: BrowserShell): string => {
  if (!canStartGitHubOAuth(shell)) {
    throw new Error('GitHub OAuth is not available for this browser shell.')
  }

  const config = shell.config
  const state = generateState()
  sessionStorage.setItem(oauthStateKey(shell), state)
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

export const startGitHubOAuth = (shell: BrowserShell): void => {
  location.assign(createGitHubLoginUrl(shell))
}

const validateOAuthState = (shell: BrowserShell, returnedState: string | null): boolean => {
  const stateKey = oauthStateKey(shell)
  const storedState = sessionStorage.getItem(stateKey)
  sessionStorage.removeItem(stateKey)
  return Boolean(storedState) && storedState === returnedState
}

const exchangeCode = async (shell: BrowserShell, code: string): Promise<string> => {
  const config = shell.config
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

export const completeGitHubOAuthCallback = async (
  app: BrowserApp,
  options: {
  code: string | null
  state: string | null
}): Promise<void> => {
  if (!options.code) {
    throw new Error('No authorization code received from GitHub.')
  }

  if (!validateOAuthState(app.shell, options.state)) {
    throw new Error('Authentication failed. Please try signing in again.')
  }

  try {
    const token = await exchangeCode(app.shell, options.code)
    await app.stores.auth.getState().setToken(token)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message || 'Authentication failed. Please try again.', { cause: error })
    }

    throw new Error('Authentication failed. Please try again.', { cause: error })
  }
}
