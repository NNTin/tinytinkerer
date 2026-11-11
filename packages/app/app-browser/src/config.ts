/**
 * How this shell authenticates.
 *
 * - `'hybrid'` (default): anonymous use on the shared key, with optional GitHub
 *   sign-in through this shell's own OAuth.
 * - `'oauth'`: sign-in REQUIRED (issue #510). A signed-out `ChatApp` shows a
 *   sign-in call to action instead of the chat and sends nothing to the edge.
 * - `'host-token'`: the host supplies the token (`hostToken`); this shell never
 *   starts OAuth itself.
 */
export type BrowserAuthMode = 'oauth' | 'host-token' | 'hybrid'

// Optional host-supplied theme (B4). An embedding page may pass colour values
// that the embedded shell maps onto its existing design tokens (--bg, --panel,
// --text, --border, --accent) so the widget visually blends into its host. All
// fields are optional; an omitted field falls back to the shell's own token.
export type ShellThemeTokens = {
  background?: string
  panel?: string
  text?: string
  border?: string
  accent?: string
}

// Callers commonly pass values read from env (`import.meta.env.X`) that may be
// undefined. Allowing explicit `undefined` here keeps the call sites ergonomic
// without forcing a conditional spread on every field.
/* eslint-disable no-restricted-syntax */
export type BrowserShellBootstrapOptions = {
  baseUrl: string
  origin: string
  edgeBaseUrl?: string | undefined
  storageNamespace?: string | undefined
  authMode?: BrowserAuthMode | undefined
  githubClientId?: string | undefined
  githubRedirectUri?: string | undefined
  manifestStartUrl?: string | undefined
  hostToken?: string | null
  sentryDsn?: string | undefined
  sentryEnvironment?: string | undefined
  appVersion?: string | undefined
  buildHash?: string | undefined
  theme?: ShellThemeTokens | undefined
}
/* eslint-enable no-restricted-syntax */

// `| undefined` on every field for the same reason (issue #518, F9): a host
// that builds the config straight from its own runtime config
// (`githubClientId: runtime.githubClientId`) must compile under
// `exactOptionalPropertyTypes`. Every reader below treats `undefined` and an
// omitted field alike.
/* eslint-disable no-restricted-syntax */
export type BrowserShellConfig = {
  edgeBaseUrl?: string | undefined
  storageNamespace?: string | undefined
  authMode?: BrowserAuthMode | undefined
  githubClientId?: string | undefined
  githubRedirectUri?: string | undefined
  manifestStartUrl?: string | undefined
  hostToken?: string | null | undefined
  sentryDsn?: string | undefined
  sentryEnvironment?: string | undefined
  appVersion?: string | undefined
  buildHash?: string | undefined
  theme?: ShellThemeTokens | undefined
}
/* eslint-enable no-restricted-syntax */

export type ResolvedBrowserShellConfig = {
  edgeBaseUrl: string
  storageNamespace: string
  authMode: BrowserAuthMode
  githubClientId?: string
  githubRedirectUri?: string
  manifestStartUrl?: string
  hostToken: string | null
  sentryDsn?: string
  sentryEnvironment: string
  appVersion: string
  buildHash: string
  theme?: ShellThemeTokens
}

const DEFAULT_CONFIG: ResolvedBrowserShellConfig = {
  edgeBaseUrl: '',
  storageNamespace: 'tinytinkerer',
  authMode: 'hybrid',
  hostToken: null,
  sentryEnvironment: 'development',
  appVersion: 'dev',
  buildHash: 'dev'
}

export const resolveBrowserShellConfig = (
  config: BrowserShellConfig = {}
): ResolvedBrowserShellConfig => {
  const resolved: ResolvedBrowserShellConfig = {
    edgeBaseUrl: config.edgeBaseUrl ?? DEFAULT_CONFIG.edgeBaseUrl,
    storageNamespace: config.storageNamespace ?? DEFAULT_CONFIG.storageNamespace,
    authMode: config.authMode ?? DEFAULT_CONFIG.authMode,
    hostToken: config.hostToken ?? DEFAULT_CONFIG.hostToken,
    sentryEnvironment: config.sentryEnvironment ?? DEFAULT_CONFIG.sentryEnvironment,
    appVersion: config.appVersion ?? DEFAULT_CONFIG.appVersion,
    buildHash: config.buildHash ?? DEFAULT_CONFIG.buildHash
  }

  if (config.sentryDsn !== undefined) {
    resolved.sentryDsn = config.sentryDsn
  }

  if (config.githubClientId !== undefined) {
    resolved.githubClientId = config.githubClientId
  }

  if (config.githubRedirectUri !== undefined) {
    resolved.githubRedirectUri = config.githubRedirectUri
  }

  if (config.manifestStartUrl !== undefined) {
    resolved.manifestStartUrl = config.manifestStartUrl
  }

  if (config.theme !== undefined) {
    resolved.theme = config.theme
  }

  return resolved
}

export const resolveBrowserShellBootstrapConfig = (
  options: BrowserShellBootstrapOptions
): BrowserShellConfig => {
  // Resolve the callback against the origin as a URL rather than string-joining
  // `origin + baseUrl`. The browser shells share ONE build served at /web/,
  // /widget/, /mobile/ and therefore ship with a RELATIVE Vite base (`./`), so
  // the old concatenation produced `https://host./#/auth/callback` — a
  // trailing-dot host that only "worked" because the real domain normalized it
  // back to the root, and an outright *invalid URL* on `http://localhost:PORT`
  // (the `:PORT.` is an illegal port). `new URL('./', origin)` resolves both
  // `./` and `/` to the origin root, and a genuine sub-path base (e.g. a deploy
  // prefix `/pr-1/`) to that path — always a well-formed URL. The callback lands
  // on whichever surface owns that path (the origin root is apps/host), and the
  // stored return URL (see startGitHubOAuth) sends the user back to the exact
  // surface they started from.
  //
  // Derived even without a client id: the edge requires the exchange to carry a
  // redirect URI on the calling page's own origin (issue #510), and the callback
  // page must still be able to complete an exchange it is handed (the e2e build
  // carries no VITE_GITHUB_CLIENT_ID). `canStartGitHubOAuth` still gates on the
  // client id, so no sign-in can START without one.
  const githubRedirectUri =
    options.githubRedirectUri ?? `${new URL(options.baseUrl, options.origin).href}#/auth/callback`

  return {
    edgeBaseUrl: options.edgeBaseUrl ?? DEFAULT_CONFIG.edgeBaseUrl,
    storageNamespace: options.storageNamespace ?? DEFAULT_CONFIG.storageNamespace,
    authMode: options.authMode ?? DEFAULT_CONFIG.authMode,
    hostToken: options.hostToken ?? DEFAULT_CONFIG.hostToken,
    appVersion: options.appVersion ?? DEFAULT_CONFIG.appVersion,
    buildHash: options.buildHash ?? DEFAULT_CONFIG.buildHash,
    ...(options.sentryDsn ? { sentryDsn: options.sentryDsn } : {}),
    ...(options.sentryEnvironment ? { sentryEnvironment: options.sentryEnvironment } : {}),
    ...(options.manifestStartUrl !== undefined
      ? { manifestStartUrl: options.manifestStartUrl }
      : {}),
    ...(options.githubClientId ? { githubClientId: options.githubClientId } : {}),
    ...(githubRedirectUri ? { githubRedirectUri } : {}),
    ...(options.theme ? { theme: options.theme } : {})
  }
}
