import { useEffect, useMemo, useState } from 'react'
import { canStartGitHubOAuth, completeGitHubOAuthCallback, startGitHubOAuth } from './auth'
import { useBrowserApp, useChatStore } from './app'
import type { ResolvedBrowserShellConfig } from './config'

export const formatCooldown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const useChatCooldown = (): { cooldownRemainingMs: number; isCoolingDown: boolean } => {
  const cooldownUntil = useChatStore((state) => state.cooldownUntil)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!cooldownUntil) return undefined
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [cooldownUntil])

  const cooldownRemainingMs = cooldownUntil ? Math.max(0, Date.parse(cooldownUntil) - now) : 0
  return { cooldownRemainingMs, isCoolingDown: cooldownRemainingMs > 0 }
}

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
