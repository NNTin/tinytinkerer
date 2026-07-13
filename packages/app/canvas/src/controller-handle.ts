import { createStageControllerHandle } from '@tinytinkerer/app-shell'
import { excalidrawVerbInputSchemas } from './inputs'

export type CanvasMethod = keyof typeof excalidrawVerbInputSchemas
export type CanvasController = {
  [TMethod in CanvasMethod]: (input: unknown) => Promise<unknown>
}

// Created in the shell startup graph; the heavy controller implementation is only
// loaded with CanvasStage. Tools can therefore queue against a stable lightweight
// handle without pulling Excalidraw into initial chat bootstrap.
export const canvasControllerHandle =
  createStageControllerHandle<CanvasController>('Canvas is still loading')
