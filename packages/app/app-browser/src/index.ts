export { useBrowserAppBootstrap } from './bootstrap'
export type { LoadingScreenProps } from './loading-screen-types'
export {
  canStartGitHubOAuth,
  completeGitHubOAuthCallback,
  consumeGitHubOAuthReturnUrl,
  startGitHubOAuth
} from './auth'
export { TINYTINKERER_BRAND_ASSET_URLS } from '@tinytinkerer/brand-assets'
export { useGitHubUser } from './github-user'
export type { GitHubUser } from './github-user'
export { useModels } from './models'
export type { ModelsState, ModelEntry } from './models'
export {
  AppBrowserProvider,
  createBrowserApp,
  initializeBrowserApp,
  useAuthStore,
  useBrowserApp,
  useChatStore,
  useSettingsStore,
  useStatusStore
} from './app'
export type { BrowserApp } from './app'
export type { AssistantContentProps } from './assistant-content'
export type {
  BrowserAuthMode,
  BrowserShellBootstrapOptions,
  BrowserShellConfig,
  ResolvedBrowserShellConfig
} from './config'
export { AssistantContent } from './assistant-content'
export { BrowserCallbackPage } from './browser-callback-page'
export { BrowserSettingsModal, McpServerList, SettingsPanel } from './browser-settings-modal'
export type { SettingsPanelProps, SettingsPanelPresentation } from './browser-settings-modal'
export { LazyBrowserSettingsModal, LazySettingsPanel } from './lazy-browser-settings-modal'
export { useStickToBottom } from './use-stick-to-bottom'
export type { StickToBottom } from './use-stick-to-bottom'
export { JumpToLatestButton } from './jump-to-latest'
export { TurnChrome, TurnActions, deriveTurnStatus } from './turn-chrome'
export type { TurnChromeProps, TurnActionsProps } from './turn-chrome'
export { ConversationEmptyState, useStarterPrompts } from './conversation-empty-state'
export type { ConversationEmptyStateProps } from './conversation-empty-state'
export { shellThemeToCssVars } from './shell-theme'
export type { ShellThemeTokens } from './config'
export { HumanPromptComposerDock } from './human-prompt-composer-dock'
export { ChatApp } from './chat-shell/chat-app'
export type { ChatAppProps, ChatMode } from './chat-shell/chat-app'
export { FloatingLayout } from './chat-shell/floating-layout'
export type { FloatingLayoutProps } from './chat-shell/floating-layout'
export { SidebarLayout } from './chat-shell/sidebar-layout'
export type { SidebarLayoutProps } from './chat-shell/sidebar-layout'
export { FloatingChatSurface } from './chat-shell/floating-chat-surface'
export type {
  FloatingChatSurfaceProps,
  ChatLoadingComponent
} from './chat-shell/floating-chat-surface'
export { DockedChatSurface } from './chat-shell/docked-chat-surface'
export type { DockedChatSurfaceProps, DockedSizeVariant } from './chat-shell/docked-chat-surface'
export {
  clampLayout,
  clampWidth,
  loadStandaloneLayout,
  saveStandaloneLayout,
  loadPersisted,
  savePersisted
} from './chat-shell/layout-geometry'
export type { WidgetLayout, WidgetDims } from './chat-shell/layout-geometry'
export { TelemetryConsentGate } from './telemetry/consent-gate'
export { LazyTelemetryConsentGate } from './telemetry/lazy-consent-gate'
export { PrivacyPolicyUpdateGate } from './telemetry/privacy-update-gate'
export { LazyPrivacyPolicyUpdateGate } from './telemetry/lazy-privacy-update-gate'
export { PrivacyPolicyDialog } from './telemetry/privacy-policy-dialog'
export { bootstrapBrowserShell } from './initialize'
export { formatCooldown, useBrowserShellConfig, useChatCooldown, useGitHubOAuth } from './hooks'
export { useWebSpeechInput } from './web-speech'
export { resolveBrowserShellBootstrapConfig } from './config'
export { BrowserAppShell } from './browser-app-shell'
export type { BrowserAppShellProps } from './browser-app-shell'
export { createBrowserShellRoot } from './create-browser-shell-root'
export type {
  BrowserShellBootScreenProps,
  CreateBrowserShellRootOptions
} from './create-browser-shell-root'
export {
  useChatComposer,
  useChatSurfaceController,
  useGitHubOAuthCallbackController,
  useSettingsSurfaceController
} from './surfaces'
export type { ChatComposer } from './surfaces'
export { ContextGauge, ContextGaugeSlot, useContextGauge } from './context-gauge'
export type { ContextGaugeProps } from './context-gauge'
export { ContextInspectorSlot, useContextInspector } from './context-inspector'
export { fetchStatus, startStatusPolling } from './status'
export type { BrowserShell } from './shell'
export { createBrowserShell } from './shell'
export { OFFLINE_SYSTEM_STATUS } from './stores/status-store'
export {
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  buildTurns,
  normalizeSelectedModel
} from '@tinytinkerer/app-core'
export type { Turn, TurnActivity, TurnActivityItem } from '@tinytinkerer/app-core'
// The runtime tool contract, re-exported so an app can build app-local tools
// (passed via createBrowserShellRoot's `appTools`) depending only on app-browser.
export type { Tool } from '@tinytinkerer/app-core'
export { TurnActivityPanel, toolLabel } from './turn-activity-panel'
export type { ResolveActivitySummarizer } from './turn-activity-panel'
export type {
  ChatEvent,
  McpDiscoveryResult,
  McpServerConfig,
  McpToolMeta,
  ServiceStatus,
  SystemStatus
} from '@tinytinkerer/contracts'
