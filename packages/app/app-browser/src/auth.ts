import { EDGE_ROUTE_PATHS, githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import type { BrowserApp } from './app'
import { readOAuthCallbackParamsFrom } from './oauth-callback-url'
import type { BrowserShell } from './shell'
import { markOAuthCallbackHandled } from './telemetry/oauth-callback-handled'
import { captureTelemetryException, getTelemetryHeaders } from './telemetry/telemetry'
import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry,
  tryParseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

const oauthStateKey = (shell: BrowserShell): string =>
  `${shell.config.storageNamespace}:oauth_state`
const oauthReturnUrlKey = (shell: BrowserShell): string =>
  `${shell.config.storageNamespace}:oauth_return_url`

const generateState = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

/**
 * The non-hash callback path an embedding host registers as its
 * `githubRedirectUri` (issue #510 T5), e.g.
 * `https://canfactory.nntin.xyz/auth/github/callback`. It sits outside `/api/`
 * and needs no client-side router: on load the host checks
 * `location.pathname === GITHUB_OAUTH_CALLBACK_PATH` and calls
 * {@link completeGitHubOAuth}. tinytinkerer's own shells keep their hash-routed
 * `…/#/auth/callback`.
 */
export const GITHUB_OAUTH_CALLBACK_PATH = '/auth/github/callback'

/**
 * Whether this shell can run its own GitHub OAuth. Needs a client id AND a
 * redirect URI: the edge only exchanges a code whose redirect URI is on the
 * calling page's own origin, so a flow without one could never complete.
 */
export const canStartGitHubOAuth = (shell: BrowserShell): boolean => {
  const config = shell.config
  return (
    config.authMode !== 'host-token' &&
    Boolean(config.githubClientId) &&
    Boolean(config.githubRedirectUri)
  )
}

/**
 * True when this shell offers no anonymous use: `authMode: 'oauth'` means a
 * signed-out reader must sign in before anything is sent to the edge (the
 * signed-out `ChatApp` shows a sign-in call to action instead of the chat).
 * The default `'hybrid'` keeps answering anonymously on the shared key.
 */
export const isSignInRequired = (shell: BrowserShell): boolean => shell.config.authMode === 'oauth'

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
  // Remember exactly where the user started so the callback can return them to
  // that surface (/, /web, /widget, /mobile, …). The callback is handled by
  // whichever surface owns the redirect_uri's path — for the shells' relative
  // base that resolves to the origin root (apps/host), so WITHOUT this every
  // login would strand the user on `/` regardless of where they clicked "Sign
  // in with GitHub". In an embedded context the top-level page is the real
  // return target (the iframe only escaped to it); otherwise it is this
  // document. Consumed once, on success, by completeGitHubOAuthCallback's caller.
  const returnUrl = isEmbeddedContext() ? getTopLevelHref() : window.location.href
  if (returnUrl) {
    sessionStorage.setItem(oauthReturnUrlKey(shell), returnUrl)
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
  if (!config.githubRedirectUri) {
    throw new Error('GitHub sign-in is not configured for this page.')
  }
  const metadata: RequestTelemetryMetadata = {
    area: 'auth.exchange',
    origin: 'edge',
    method: 'POST',
    url: `${config.edgeBaseUrl}${EDGE_ROUTE_PATHS.authGithubExchange}`
  }
  const response = await fetchWithTelemetry(metadata, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getTelemetryHeaders() },
    // Required by the edge, which checks its origin against this page's Origin.
    body: JSON.stringify({ code, redirectUri: config.githubRedirectUri })
  })

  if (!response.ok) {
    const payload = await tryParseJsonWithTelemetry<unknown>(metadata, response.clone())
    const parsedPayload =
      payload === undefined ? undefined : githubExchangeResponseSchema.safeParse(payload)

    throw new Error(
      parsedPayload?.success
        ? (parsedPayload.data.error ?? 'OAuth exchange failed')
        : 'OAuth exchange failed'
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

type OAuthCallbackStep = 'missing_code' | 'state_validation' | 'code_exchange'

// Sentry capture for a client-side GitHub OAuth callback failure. Complements
// the edge capture (issue #409): the `missing_code` and `state_validation` steps
// throw before any network call, so they never reach the edge and would
// otherwise be invisible; `code_exchange` records the login attempt's failure
// with the reason the edge relayed. NEVER include the authorization code — only
// the step and the (already user-safe) error message are attached. Consent
// gating and `beforeSend` scrubbing still apply downstream (see
// docs/sentry-telemetry.md).
const captureOAuthCallbackFailure = (step: OAuthCallbackStep, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  captureTelemetryException(
    error instanceof Error ? error : new Error(`GitHub OAuth callback failed: ${step}`),
    {
      level: 'error',
      tags: { source: 'oauth', oauth_step: step },
      contexts: { oauth: { step, message } },
      // Each step is a distinct failure mode; without an explicit fingerprint the
      // shared synthetic frame would conflate them into a single Sentry issue.
      fingerprint: ['oauth-callback', step]
    }
  )
}

export const completeGitHubOAuthCallback = async (
  app: BrowserApp,
  options: {
    code: string | null
    state: string | null
  }
): Promise<void> => {
  if (!options.code) {
    const error = new Error('No authorization code received from GitHub.')
    captureOAuthCallbackFailure('missing_code', error)
    throw error
  }

  if (!validateOAuthState(app.shell, options.state)) {
    const error = new Error('Authentication failed. Please try signing in again.')
    captureOAuthCallbackFailure('state_validation', error)
    throw error
  }

  try {
    const token = await exchangeCode(app.shell, options.code)
    await app.stores.auth.getState().setToken(token)
  } catch (error) {
    captureOAuthCallbackFailure('code_exchange', error)
    if (error instanceof Error) {
      throw new Error(error.message || 'Authentication failed. Please try again.', { cause: error })
    }

    throw new Error('Authentication failed. Please try again.', { cause: error })
  }
}

// Only a same-origin return URL can be restored with `history.replaceState`
// (which throws on a cross-origin URL), and only one is safe to hand a host to
// navigate to. Anything else — a malformed value, or an embedded flow that
// started on another origin's top-level page — is dropped.
const toSameOriginReturnUrl = (returnUrl: string | null): string | null => {
  if (!returnUrl) return null
  try {
    return new URL(returnUrl, window.location.href).origin === window.location.origin
      ? returnUrl
      : null
  } catch {
    return null
  }
}

/**
 * Finish a GitHub sign-in on an embedding host's own callback page (issue #510
 * T5). Call it on load when `location.pathname === GITHUB_OAUTH_CALLBACK_PATH`.
 *
 * Reads `code` and `state` from `url` (default: the current location; both the
 * plain-query and hash-routed callback shapes are understood), checks `state`
 * against the one {@link startGitHubOAuth} stored under the app's
 * `storageNamespace`, exchanges the code through the edge, and signs `app` in
 * (persisting the token like any other sign-in). Resolves to the URL the reader
 * started from — same-origin only — or `null` when none was saved; the host
 * restores it with `history.replaceState(null, '', returnUrl)`, which also
 * removes `code`/`state` from the address bar. With `null`, the host should
 * still replace the callback URL with a landing page of its choice.
 *
 * Rejects with a user-presentable `Error` when the code is missing, the state
 * does not match (the CSRF check), or the exchange fails. Each failure is
 * reported to telemetry like the shells' own callback; the authorization code
 * itself is never reported.
 *
 * The app does not need to be mounted: the token is persisted to the app's
 * token storage and picked up by `initializeBrowserApp`. A host that mounts the
 * app first should await this before rendering `ChatApp`.
 */
export const completeGitHubOAuth = async (
  app: BrowserApp,
  url: string | URL = window.location.href
): Promise<string | null> => {
  // Defuses the boot-time "no handler ran" watchdog, exactly as the shells'
  // callback controller does when it mounts.
  markOAuthCallbackHandled()
  await completeGitHubOAuthCallback(app, readOAuthCallbackParamsFrom(new URL(url)))
  return toSameOriginReturnUrl(consumeGitHubOAuthReturnUrl(app.shell))
}
