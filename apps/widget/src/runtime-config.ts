import type { BrowserShellConfig } from '@tinytinkerer/app-browser'

export type WidgetViewMode = 'host' | 'standalone'
export type WidgetWindowMode = 'expanded' | 'minimized'

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

export const resolveWidgetViewMode = (search: string): WidgetViewMode =>
  new URLSearchParams(search).get('view') === 'host' ? 'host' : 'standalone'

export const resolveWidgetWindowMode = (search: string): WidgetWindowMode =>
  new URLSearchParams(search).get('mode') === 'minimized' ? 'minimized' : 'expanded'
