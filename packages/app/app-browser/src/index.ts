export { useBrowserAppBootstrap } from './bootstrap'
export type { LoadingScreenProps } from './loading-screen-types'
export { LoadingStatusPanel } from './loading-status-panel'
export type { LoadingStatusPanelProps, LoadingStatusPanelVariant } from './loading-status-panel'
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
  useOptionalBrowserApp,
  useSettingsStore,
  useStatusStore
} from './app'
export type { AppSignIn, BrowserApp, ConversationResetBehavior } from './app'
export { PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY } from './pre-send-disclosure-key'
export type { PreSendDisclosure } from './pre-send-disclosure-key'
export {
  DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES,
  NO_GLOBAL_HOST_CAPABILITIES,
  resolveDocumentGlobalCapabilities,
  resolveGlobalHostCapabilities
} from './document-globals'
export type { DocumentGlobalCapabilities, GlobalHostCapabilities } from './document-globals'
export type {
  AppAssistantPolicy,
  AppInstructionBoundary,
  AppToolResultRecord
} from './app-assistant-policy'
export type { AssistantContentProps } from './assistant-content'
export { assistantContentPlugins } from './assistant-content'
export {
  ContentPlaygroundPreview,
  PLAYGROUND_ERROR_DEMO_LANGUAGE,
  parsePlaygroundMarkdown,
  playgroundContentPlugins,
  resolvePlaygroundNodePlugin,
  useCopyButtonState
} from './content-playground'
export type {
  ContentDocument,
  ContentNode,
  ContentPlaygroundPreviewProps,
  PlaygroundPluginResolution
} from './content-playground'
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
export { useDialogFocus, useDialogEscape } from './use-dialog-focus'
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
  clampSize,
  loadStandaloneLayout,
  saveStandaloneLayout,
  loadPersisted,
  savePersisted,
  detectSnapEdge,
  snapPreviewRect,
  isVerticalEdge,
  SNAP_THRESHOLD,
  SNAP_PREVIEW_FRACTION
} from './chat-shell/layout-geometry'
export type {
  WidgetLayout,
  WidgetDims,
  SnapEdge,
  Viewport,
  PreviewRect
} from './chat-shell/layout-geometry'
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
export { AppErrorBoundary } from './app-error-boundary'
export type { AppErrorBoundaryProps } from './app-error-boundary'
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
export type { ChatComposer, ChatSurfaceController } from './surfaces'
export { ContextGauge, ContextGaugeSlot, useContextGauge } from './context-gauge'
export type { ContextGaugeProps } from './context-gauge'
export { ContextInspectorSlot, useContextInspector } from './context-inspector'
export { useToolTree, ToolTreeSlot } from './tool-tree'
export { genericToolTreeSummarizer } from './generic-tool-tree-summarizer'
export { appToolCatalogue, createAppToolRunInstances } from './app-tool-group'
export {
  resolveDockedPanelInsets,
  useDockedPanelMetrics
} from './chat-shell/use-docked-panel-metrics'
export type { DockedPanelInsets, DockedPanelMetrics } from './chat-shell/use-docked-panel-metrics'
export type {
  AppTool,
  AppToolGroup,
  AppToolRunBindings,
  AppToolRunImplementation
} from './app-tool-group'
// The content node types an app's render-time policy operates on. Re-exported
// here for the same reason ContentDocument/ContentNode already are: an app
// (apps/docs) does not depend on @tinytinkerer/contracts directly.
export type { BlockNode, InlineNode, ListItemNode, TableCell } from '@tinytinkerer/contracts'
export type { ToolTreeView, ToolTreeSummarizer } from '@tinytinkerer/contracts'
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
export type {
  ActivityStatus,
  ActivitySummarizer,
  ActivityView,
  ActivityViewSection
} from '@tinytinkerer/app-core'
export { TurnActivityPanel, toolLabel } from './turn-activity-panel'
export type { ResolveActivitySummarizer } from './turn-activity-panel'
export type {
  AgentType,
  ChatEvent,
  InspectorEntry,
  InspectorRequestPayload,
  McpDiscoveryResult,
  McpServerConfig,
  McpToolMeta,
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusLoadFailure,
  DocumentationCorpusLocator,
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry,
  DocumentationCorpusOutlineItem,
  DocumentationCorpusReadTruncation,
  DocumentationCorpusSchemaVersion,
  DocumentationCorpusSection,
  DocumentationSearchFailure,
  DocumentationSearchFailureCode,
  DocumentationSearchResponse,
  DocumentationSearchResult,
  DocumentationSearchSuccess,
  ServiceStatus,
  SystemStatus
} from '@tinytinkerer/contracts'
export { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/contracts'
export { createAppShellRouter } from './app-shell-router'
export type { AppShellPageModule, CreateAppShellRouterOptions } from './app-shell-router'
export { createAppLoadingScreens } from './app-loading-screens'
export type { AppLoadingScreenProps, CreateAppLoadingScreensOptions } from './app-loading-screens'
