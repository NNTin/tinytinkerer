import { EDGE_ROUTE_PATHS, githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import type { BrowserApp } from './app'
import type { BrowserShell } from './shell'
import { getTelemetryHeaders } from './telemetry/telemetry'
import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry,
  tryParseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

const oauthStateKey = (shell: BrowserShell): string => `${shell.config.storageNamespace}:oauth_state`
const oauthReturnUrlKey = (shell: BrowserShell): string => `${shell.config.storageNamespace}:oauth_return_url`

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

const isEmbeddedContext = (): boolean => {
  try {
    return window.parent !== window
  } catch {
    return false
  }
}

const getTopLevelHref = (): string | null => {
  try {
    return window.top?.location.href ?? null
  } catch {
    return null
  }
}

const navigateForOAuth = (url: string): void => {
  if (isEmbeddedContext()) {
    const topLocation = window.top?.location
    if (topLocation) {
      topLocation.assign(url)
      return
    }
  }

  location.assign(url)
}

export const startGitHubOAuth = (shell: BrowserShell): void => {
  if (isEmbeddedContext()) {
    const returnUrl = getTopLevelHref()
    if (returnUrl) {
      sessionStorage.setItem(oauthReturnUrlKey(shell), returnUrl)
    }
  }

  navigateForOAuth(createGitHubLoginUrl(shell))
}

const validateOAuthState = (shell: BrowserShell, returnedState: string | null): boolean => {
  const stateKey = oauthStateKey(shell)
  const storedState = sessionStorage.getItem(stateKey)
  sessionStorage.removeItem(stateKey)
  return Boolean(storedState) && storedState === returnedState
}

export const consumeGitHubOAuthReturnUrl = (shell: BrowserShell): string | null => {
  const key = oauthReturnUrlKey(shell)
  const returnUrl = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  return returnUrl
}

const exchangeCode = async (shell: BrowserShell, code: string): Promise<string> => {
  const config = shell.config
  const metadata: RequestTelemetryMetadata = {
    area: 'auth.exchange',
    origin: 'edge',
    method: 'POST',
    url: `${config.edgeBaseUrl}${EDGE_ROUTE_PATHS.authGithubExchange}`
  }
  const response = await fetchWithTelemetry(metadata, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getTelemetryHeaders() },
    body: JSON.stringify({
      code,
      ...(config.githubRedirectUri ? { redirectUri: config.githubRedirectUri } : {})
    })
  })

  if (!response.ok) {
    const payload = await tryParseJsonWithTelemetry<unknown>(metadata, response.clone())
    const parsedPayload = payload === undefined
      ? undefined
      : githubExchangeResponseSchema.safeParse(payload)

    throw new Error(
      parsedPayload?.success ? (parsedPayload.data.error ?? 'OAuth exchange failed') : 'OAuth exchange failed'
    )
  }

  const payload = await parseJsonWithTelemetry<unknown>(metadata, response)
  const data = parseWithTelemetry(
    metadata,
    'schema_error',
    'OAuth exchange response did not match schema',
    () => githubExchangeResponseSchema.parse(payload),
    response
  )
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
