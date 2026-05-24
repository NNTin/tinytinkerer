import type { BrowserShellConfig } from '@tinytinkerer/app-browser'

export const resolveWidgetGitHubRedirectUri = (
  hostConfig: BrowserShellConfig,
  githubClientId: string | undefined,
  configuredRedirectUri: string | undefined,
  baseUrl: string,
  origin: string
): string | undefined => {
  if (hostConfig.githubRedirectUri) {
    return hostConfig.githubRedirectUri
  }

  if (configuredRedirectUri) {
    return configuredRedirectUri
  }

  return githubClientId
    ? `${origin}${baseUrl}#/auth/callback`
    : undefined
}
