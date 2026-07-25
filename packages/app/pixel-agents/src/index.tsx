import { lazy, Suspense } from 'react'
import type { PixelAgentsStageProps } from './stage-props'

const PixelAgentsWorkspace = lazy(() =>
  import('./pixel-agents-stage').then((module) => ({ default: module.PixelAgentsWorkspace }))
)

export const PixelAgentsStage = (props: PixelAgentsStageProps): React.JSX.Element => (
  <Suspense fallback={<div className="pixel-agents-loading">Opening Pixel Agents…</div>}>
    <PixelAgentsWorkspace {...props} />
  </Suspense>
)

export type {
  PixelAgentsConversation,
  PixelAgentsStageActions,
  PixelAgentsStageProps
} from './stage-props'
export { conversationActivityStatus } from './activity'
export type { PixelAgentsActivityStatus } from './activity'
export { createPixelAgentsWorkspaceStore } from './workspace-db'
