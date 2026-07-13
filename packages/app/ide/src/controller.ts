import { createStageControllerHandle } from '@tinytinkerer/app-shell'
import type { ApplyFileChangesInput } from '@tinytinkerer/file-tools'

export type IdeController = {
  inspectWorkspace(): unknown
  searchFiles(input: { query: string; maxResults: number }): unknown
  readFiles(input: { paths: string[] }): unknown
  applyFileChanges(input: ApplyFileChangesInput): Promise<unknown>
  inspectRuntime(input: { maxLogs: number }): unknown
  restartRuntime(): Promise<unknown>
  undoLastChange(): Promise<boolean>
  redoLastChange(): Promise<boolean>
}

export type IdeControllerHandle = {
  setController(controller: IdeController | null): void
  request(method: keyof IdeController, input?: unknown): Promise<unknown>
  undoLastChange(): Promise<boolean>
  redoLastChange(): Promise<boolean>
}

export const createIdeControllerHandle = (): IdeControllerHandle => {
  const stageHandle = createStageControllerHandle<IdeController>('IDE is still loading')
  let mounted = false
  return {
    setController(next) {
      mounted = next !== null
      stageHandle.setController(next)
    },
    request(method, input) {
      return stageHandle.request(method, input)
    },
    async undoLastChange() {
      return mounted ? ((await stageHandle.request('undoLastChange')) as boolean) : false
    },
    async redoLastChange() {
      return mounted ? ((await stageHandle.request('redoLastChange')) as boolean) : false
    }
  }
}

export const ideControllerHandle = createIdeControllerHandle()
