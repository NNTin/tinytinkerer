import { initializeBrowserShell } from '@tinytinkerer/app-browser'

let browserShellInitialized = false

export const ensureBrowserShellInitialized = (): void => {
  if (browserShellInitialized) {
    return
  }

  const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  const githubRedirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI

  initializeBrowserShell({
    edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
    storageNamespace: 'tinytinkerer-web',
    authMode: 'hybrid',
    ...(githubClientId ? { githubClientId } : {}),
    ...(githubRedirectUri ? { githubRedirectUri } : {})
  })

  browserShellInitialized = true
}
