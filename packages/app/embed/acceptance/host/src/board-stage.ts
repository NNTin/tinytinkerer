// The host's "editor": a stage controller installed at startup, before the
// assistant exists (issue #523, G1). The handle comes from the side-effect-free
// `/stage` subpath, so this module is safe on the startup path; run.mjs
// measures that it stays so. The lazy assistant's tool reaches the controller
// only through the handle.
import {
  createStageControllerHandle,
  type StageControllerHandle
} from '@nntin/tinytinkerer-embed/stage'

export type BoardController = {
  measure(input: unknown): { board: string; widthMm: number; heightMm: number }
}

export const boardStage: StageControllerHandle<BoardController> =
  createStageControllerHandle<BoardController>('The board editor is not mounted.')

export const installBoardController = (): void => {
  boardStage.setController({
    measure: (input) => {
      const { board } = input as { board: string }
      return { board, widthMm: 70, heightMm: 90 }
    }
  })
}
