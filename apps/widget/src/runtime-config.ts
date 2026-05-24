import type { BrowserShellConfig } from '@tinytinkerer/app-browser'

export const resolveWidgetGitHubRedirectUri = (
  hostConfig: BrowserShellConfig,
  githubClientId: string | undefined,
  baseUrl: string,
  origin: string
): string | undefined => {
  if (hostConfig.githubRedirectUri) {
    return hostConfig.githubRedirectUri
  }

  return githubClientId
    ? `${origin}${baseUrl}#/auth/callback`
    : undefined
}
