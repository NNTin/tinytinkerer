import { lazy, Suspense } from 'react'
import type { CanvasStageProps } from './stage-props'

const CanvasWorkspace = lazy(() =>
  import('./canvas-stage').then((module) => ({ default: module.CanvasWorkspace }))
)

// Keep the stage implementation behind a package-local lazy boundary. The shell
// imports this same entry at startup to register tools; loading Excalidraw only when
// the canvas route renders preserves a fast chat bootstrap without an iframe build.
export const CanvasStage = (props: CanvasStageProps): React.JSX.Element => (
  <Suspense fallback={<div className="canvas-loading">Opening canvas…</div>}>
    <CanvasWorkspace {...props} />
  </Suspense>
)

export type { CanvasStageProps } from './stage-props'
export { canvasControllerHandle } from './controller-handle'
export type { CanvasController, CanvasMethod } from './controller-handle'
export { createCanvasAppTools } from './tools'
