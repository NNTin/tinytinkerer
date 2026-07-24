// @tinytinkerer/app-shell — shared infrastructure for integrated application stages.
export { AppStageShell } from './app-stage-shell'
export type { AppStageShellProps } from './app-stage-shell'

export { DockablePanelLayout } from './dockable-panel-layout'
export type {
  DockableLayoutPreset,
  DockablePanel,
  DockablePanelLayoutProps,
  DockablePanels
} from './dockable-panel-layout'

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
export type {
  ActivityStatus,
  ActivitySummarizer,
  ActivityView,
  ActivityViewSection
} from '@tinytinkerer/contracts'
export { partitionToolResultMedia } from '@tinytinkerer/contracts'

export { useRequestAssistantAction } from './assistant-action'
export type { RequestAssistantAction } from './assistant-action'

export { useLiveChatActivity } from './live-chat-activity'
export type { UseLiveChatActivityOptions } from './live-chat-activity'

// Re-exported so integrated stages (e.g. the Mermaid export modal) reuse the
// shared aria-modal keyboard/focus behavior instead of forking it.
export { useDialogFocus, useDialogEscape } from '@tinytinkerer/app-browser'
