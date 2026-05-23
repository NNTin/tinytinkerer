export type BrowserAuthMode = 'oauth' | 'host-token' | 'hybrid'

export type BrowserShellConfig = {
  edgeBaseUrl?: string
  storageNamespace?: string
  authMode?: BrowserAuthMode
  githubClientId?: string
  githubRedirectUri?: string
  hostToken?: string | null
}

export type ResolvedBrowserShellConfig = {
  edgeBaseUrl: string
  storageNamespace: string
  authMode: BrowserAuthMode
  githubClientId?: string
  githubRedirectUri?: string
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
): ResolvedBrowserShellConfig => ({
  edgeBaseUrl: config.edgeBaseUrl ?? DEFAULT_CONFIG.edgeBaseUrl,
  storageNamespace: config.storageNamespace ?? DEFAULT_CONFIG.storageNamespace,
  authMode: config.authMode ?? DEFAULT_CONFIG.authMode,
  githubClientId: config.githubClientId,
  githubRedirectUri: config.githubRedirectUri,
  hostToken: config.hostToken ?? DEFAULT_CONFIG.hostToken
})
