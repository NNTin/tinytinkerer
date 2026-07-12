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
  let controller: IdeController | null = null
  return {
    setController(next) {
      controller = next
    },
    request(method, input) {
      if (!controller) return Promise.reject(new Error('IDE is still loading'))
      const member = controller[method] as (value?: unknown) => unknown
      try {
        return Promise.resolve(member.call(controller, input))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    async undoLastChange() {
      return controller ? controller.undoLastChange() : false
    },
    async redoLastChange() {
      return controller ? controller.redoLastChange() : false
    }
  }
}

export const ideControllerHandle = createIdeControllerHandle()
