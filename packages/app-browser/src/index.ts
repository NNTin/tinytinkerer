export { canStartGitHubOAuth, completeGitHubOAuthCallback, startGitHubOAuth } from './auth'
export {
  AppBrowserProvider,
  createBrowserApp,
  useAuthStore,
  useBrowserApp,
  useChatStore,
  useSettingsStore,
  useStatusStore
} from './app'
export type { BrowserApp } from './app'
export type { BrowserAuthMode, BrowserShellConfig, ResolvedBrowserShellConfig } from './config'
export { bootstrapBrowserShell } from './initialize'
export { useBrowserShellConfig, useGitHubOAuth } from './hooks'
export { fetchStatus, startStatusPolling } from './status'
export type { BrowserShell } from './shell'
export { createBrowserShell } from './shell'
export { isSearchReady } from './stores/status-store'
export {
  DEFAULT_MODEL,
  SUPPORTED_MODELS,
  buildCurrentTimeline,
  buildTurns,
  normalizeSelectedModel
} from '@tinytinkerer/app-core'
export type { TimelineEntry, Turn } from '@tinytinkerer/app-core'
export type { ChatEvent, ServiceStatus, SystemStatus } from '@tinytinkerer/contracts'
