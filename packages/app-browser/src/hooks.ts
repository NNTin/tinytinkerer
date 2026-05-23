import { useMemo } from 'react'
import { canStartGitHubOAuth, completeGitHubOAuthCallback, startGitHubOAuth } from './auth'
import { useBrowserApp } from './app'
import type { ResolvedBrowserShellConfig } from './config'

export const useBrowserShellConfig = (): ResolvedBrowserShellConfig => useBrowserApp().shell.config

export const useGitHubOAuth = () => {
  const app = useBrowserApp()

  return useMemo(
    () => ({
      canStartGitHubOAuth: canStartGitHubOAuth(app.shell),
      startGitHubOAuth: () => startGitHubOAuth(app.shell),
      completeGitHubOAuthCallback: (options: { code: string | null; state: string | null }) =>
        completeGitHubOAuthCallback(app, options)
    }),
    [app]
  )
}
