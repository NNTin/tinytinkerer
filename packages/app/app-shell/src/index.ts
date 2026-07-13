// @tinytinkerer/app-shell — the shared harness that hosts a sandboxed iframe app
// and wires it into the chat shell. A per-app shell composes <HarnessShell> (or
// <AppFrame> directly), declares its app's verbs, and passes the resulting
// appTools to createBrowserShellRoot — keeping each shell thin and app-agnostic.
export { createAppBridgeHandle } from './bridge-handle'
export type { AppBridgeHandle, AppBridgeStatus } from './bridge-handle'

export { appToolsFromVerbs } from './app-tools'
export type { VerbDefinition, AppToolsFromVerbsOptions } from './app-tools'

export { AppFrame, APP_BRIDGE_NONCE_PARAM } from './app-frame'
export type { AppFrameProps, AppFrameStatus } from './app-frame'

export { HarnessShell } from './harness-shell'
export type { HarnessShellProps } from './harness-shell'

export { AppStageShell } from './app-stage-shell'
export type { AppStageShellProps } from './app-stage-shell'

export { DockablePanelLayout } from './dockable-panel-layout'
export type {
  DockableLayoutPreset,
  DockablePanel,
  DockablePanelLayoutProps
} from './dockable-panel-layout'

export { resolveEmbeddedAppUrl } from './app-url'

export { createStageControllerHandle } from './stage-controller'
export type { StageControllerHandle } from './stage-controller'

export { createWorkspaceStore } from './workspace-store'
export type { WorkspaceRecord, WorkspaceStore } from './workspace-store'

export { createStageTools } from './stage-tools'
export type {
  CreateStageToolsOptions,
  StageToolDefinition,
  StageToolRequestHandle
} from './stage-tools'

export { useRequestAssistantAction } from './assistant-action'
export type { RequestAssistantAction } from './assistant-action'
