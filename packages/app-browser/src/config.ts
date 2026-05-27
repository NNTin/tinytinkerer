export type BrowserAuthMode = 'oauth' | 'host-token' | 'hybrid'

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
}
/* eslint-enable no-restricted-syntax */

export type BrowserShellConfig = {
  edgeBaseUrl?: string
  storageNamespace?: string
  authMode?: BrowserAuthMode
  githubClientId?: string
  githubRedirectUri?: string
  manifestStartUrl?: string
  hostToken?: string | null
}

export type ResolvedBrowserShellConfig = {
  edgeBaseUrl: string
  storageNamespace: string
  authMode: BrowserAuthMode
  githubClientId?: string
  githubRedirectUri?: string
  manifestStartUrl?: string
  hostToken: string | null
}

const DEFAULT_CONFIG: ResolvedBrowserShellConfig = {
  edgeBaseUrl: '',
  storageNamespace: 'tinytinkerer',
  authMode: 'hybrid',
  hostToken: null
}

export const resolveBrowserShellConfig = (
  config: BrowserShellConfig = {}
): ResolvedBrowserShellConfig => {
  const resolved: ResolvedBrowserShellConfig = {
    edgeBaseUrl: config.edgeBaseUrl ?? DEFAULT_CONFIG.edgeBaseUrl,
    storageNamespace: config.storageNamespace ?? DEFAULT_CONFIG.storageNamespace,
    authMode: config.authMode ?? DEFAULT_CONFIG.authMode,
    hostToken: config.hostToken ?? DEFAULT_CONFIG.hostToken
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

  return resolved
}

export const resolveBrowserShellBootstrapConfig = (
  options: BrowserShellBootstrapOptions
): BrowserShellConfig => {
  const githubRedirectUri =
    options.githubRedirectUri ??
    (options.githubClientId ? `${options.origin}${options.baseUrl}#/auth/callback` : undefined)

  return {
    edgeBaseUrl: options.edgeBaseUrl ?? DEFAULT_CONFIG.edgeBaseUrl,
    storageNamespace: options.storageNamespace ?? DEFAULT_CONFIG.storageNamespace,
    authMode: options.authMode ?? DEFAULT_CONFIG.authMode,
    hostToken: options.hostToken ?? DEFAULT_CONFIG.hostToken,
    ...(options.manifestStartUrl !== undefined ? { manifestStartUrl: options.manifestStartUrl } : {}),
    ...(options.githubClientId ? { githubClientId: options.githubClientId } : {}),
    ...(githubRedirectUri ? { githubRedirectUri } : {})
  }
}
