export {
  canStartGitHubOAuth,
  completeGitHubOAuthCallback,
  startGitHubOAuth
} from './auth'
export type { BrowserAuthMode, BrowserShellConfig, ResolvedBrowserShellConfig } from './config'
export { bootstrapBrowserShell } from './initialize'
export { getBrowserShellConfig } from './shell'
export { fetchStatus, startStatusPolling } from './status'
export { useAuthStore } from './stores/auth-store'
export { useChatStore } from './stores/chat-store'
export { useSettingsStore } from './stores/settings-store'
export { isSearchReady, useStatusStore } from './stores/status-store'
export {
  DEFAULT_MODEL,
  SUPPORTED_MODELS,
  buildCurrentTimeline,
  buildTurns,
  normalizeSelectedModel
} from '@tinytinkerer/app-core'
export type { TimelineEntry, Turn } from '@tinytinkerer/app-core'
export type { ChatEvent, ServiceStatus, SystemStatus } from '@tinytinkerer/contracts'
