// The side-effect-free GitHub sign-in facade for embedding hosts (issue #518,
// F3), published as `@nntin/tinytinkerer-embed/oauth`.
//
// A host that must finish GitHub's redirect before its own router runs does so
// from its EAGER entry, where importing the package root would put the whole
// runtime in the startup bundle (+437 KB gz, measured by CanFactory). So this
// module imports nothing but two leaf modules — no React, no Zod, no Dexie, no
// telemetry, no stores — and the embed build's check-package.mjs asserts that
// its chunk graph stays that way.
//
// It is also the single source of the sign-in's storage keys: auth.ts (the
// app-bound flow) imports them from here, so the light completion below and
// the app it hands the token to can never disagree about a key.
import { readOAuthCallbackParamsFrom } from './oauth-callback-url'
import { markOAuthCallbackHandled } from './telemetry/oauth-callback-handled'

/**
 * The non-hash callback path an embedding host registers as its
 * `githubRedirectUri` (issue #510 T5), e.g.
 * `https://canfactory.nntin.xyz/auth/github/callback`. It sits outside `/api/`
 * and needs no client-side router: on load the host checks
 * {@link isGitHubOAuthCallback} and calls `completeGitHubOAuth`.
 * tinytinkerer's own shells keep their hash-routed `…/#/auth/callback`.
 */
export const GITHUB_OAUTH_CALLBACK_PATH = '/auth/github/callback'

/**
 * The edge's code-exchange route. Repeated here rather than read from
 * `@tinytinkerer/contracts`, whose module also builds every Zod schema;
 * tests/oauth-subpath.test.ts pins it to `EDGE_ROUTE_PATHS.authGithubExchange`.
 */
export const GITHUB_OAUTH_EXCHANGE_PATH = '/auth/github/exchange'

const DEFAULT_STORAGE_NAMESPACE = 'tinytinkerer'

const namespaceOf = (storageNamespace: string | undefined): string =>
  storageNamespace ?? DEFAULT_STORAGE_NAMESPACE

/** sessionStorage: the CSRF `state` startGitHubOAuth sent to GitHub. */
export const oauthStateStorageKey = (storageNamespace: string | undefined): string =>
  `${namespaceOf(storageNamespace)}:oauth_state`

/** sessionStorage: the page the reader started signing in from. */
export const oauthReturnUrlStorageKey = (storageNamespace: string | undefined): string =>
  `${namespaceOf(storageNamespace)}:oauth_return_url`

/**
 * localStorage: a token the light {@link completeGitHubOAuth} exchanged before
 * any app existed. The app's auth store moves it into its own token storage on
 * the next `initializeBrowserApp` and deletes it (stores/auth-store.ts).
 * localStorage rather than sessionStorage so the sign-in survives the reader
 * opening the assistant in another tab; it is readable by exactly the same
 * scripts as the app's IndexedDB token storage, the host origin's.
 */
export const oauthPendingTokenStorageKey = (storageNamespace: string | undefined): string =>
  `${namespaceOf(storageNamespace)}:oauth_pending_token`

/**
 * True when `url` (default: the current location) is GitHub's redirect to
 * {@link GITHUB_OAUTH_CALLBACK_PATH}. Compares the path only; the code and
 * state are checked by `completeGitHubOAuth`.
 */
export const isGitHubOAuthCallback = (url: string | URL = window.location.href): boolean =>
  new URL(url, window.location.href).pathname === GITHUB_OAUTH_CALLBACK_PATH

/**
 * Removes and compares the stored CSRF state. Removed whatever the outcome: a
 * state is good for exactly one callback.
 */
export const consumeOAuthState = (
  storageNamespace: string | undefined,
  returnedState: string | null
): boolean => {
  const key = oauthStateStorageKey(storageNamespace)
  const storedState = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  return Boolean(storedState) && storedState === returnedState
}

/** Removes and returns the page the reader started signing in from. */
export const consumeOAuthReturnUrl = (storageNamespace: string | undefined): string | null => {
  const key = oauthReturnUrlStorageKey(storageNamespace)
  const returnUrl = sessionStorage.getItem(key)
  sessionStorage.removeItem(key)
  return returnUrl
}

// Only a same-origin return URL can be restored with `history.replaceState`
// (which throws on a cross-origin URL), and only one is safe to hand a host to
// navigate to. Anything else — a malformed value, or an embedded flow that
// started on another origin's top-level page — is dropped.
export const toSameOriginReturnUrl = (returnUrl: string | null): string | null => {
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
 * What {@link completeGitHubOAuth} reads from the app's configuration:
 * `Pick<BrowserShellConfig, 'edgeBaseUrl' | 'storageNamespace' | 'githubRedirectUri'>`,
 * spelled out so this module imports no type graph either
 * (tests/oauth-subpath.test.ts keeps the two identical).
 */
/* eslint-disable no-restricted-syntax -- mirrors BrowserShellConfig (config.ts) */
export type GitHubOAuthCallbackConfig = {
  edgeBaseUrl?: string | undefined
  storageNamespace?: string | undefined
  githubRedirectUri?: string | undefined
}
/* eslint-enable no-restricted-syntax */

const errorMessageOf = (payload: unknown): string | undefined =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : undefined

const exchangeCode = async (config: GitHubOAuthCallbackConfig, code: string): Promise<string> => {
  if (!config.githubRedirectUri) {
    throw new Error('GitHub sign-in is not configured for this page.')
  }
  // A raw fetch on purpose: fetchWithTelemetry would bring the telemetry
  // client into this chunk, and an embedding host runs no TinyTinkerer
  // telemetry anyway (the app-bound completion in host-oauth-callback.ts keeps
  // the reporting).
  // eslint-disable-next-line no-restricted-globals
  const response = await fetch(`${config.edgeBaseUrl ?? ''}${GITHUB_OAUTH_EXCHANGE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Required by the edge, which checks its origin against this page's Origin.
    body: JSON.stringify({ code, redirectUri: config.githubRedirectUri })
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(errorMessageOf(payload) ?? 'OAuth exchange failed')
  }
  const accessToken =
    typeof payload === 'object' && payload !== null
      ? (payload as { accessToken?: unknown }).accessToken
      : undefined
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('Authentication failed')
  }
  return accessToken
}

/**
 * Finish a GitHub sign-in on an embedding host's callback page WITHOUT a
 * `BrowserApp` (issue #518, F3): the host's eager entry can call it before its
 * router runs and before the runtime chunk is downloaded.
 *
 * Pass the same `edgeBaseUrl`, `storageNamespace` and `githubRedirectUri` the
 * app is created with — usually the very object `resolveBrowserShellBootstrapConfig`
 * returned, or the values it was built from. It reads `code` and `state` from
 * `url` (default: the current location), checks `state` against the one the
 * app's sign-in button stored, exchanges the code through the edge, and saves
 * the token so the next `initializeBrowserApp` with that `storageNamespace`
 * starts signed in. Resolves to the URL the reader started from (same-origin
 * only) or `null`; restore it with `history.replaceState(null, '', returnUrl)`,
 * which also removes `code`/`state` from the address bar.
 *
 * Rejects with a user-presentable `Error` when the code is missing, the state
 * does not match (the CSRF check), or the exchange fails. Unlike the
 * root export's `completeGitHubOAuth(app, url)`, nothing is reported to
 * telemetry.
 *
 * An app that is ALREADY running in this document does not see the token until
 * it boots again; a host that has one should call the root export instead.
 */
export const completeGitHubOAuth = async (
  config: GitHubOAuthCallbackConfig,
  url: string | URL = window.location.href
): Promise<string | null> => {
  markOAuthCallbackHandled()
  const { code, state } = readOAuthCallbackParamsFrom(new URL(url, window.location.href))
  if (!code) {
    throw new Error('No authorization code received from GitHub.')
  }
  if (!consumeOAuthState(config.storageNamespace, state)) {
    throw new Error('Authentication failed. Please try signing in again.')
  }
  let token: string
  try {
    token = await exchangeCode(config, code)
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : undefined
    throw new Error(message ?? 'Authentication failed. Please try again.', { cause: error })
  }
  localStorage.setItem(oauthPendingTokenStorageKey(config.storageNamespace), token)
  return toSameOriginReturnUrl(consumeOAuthReturnUrl(config.storageNamespace))
}
