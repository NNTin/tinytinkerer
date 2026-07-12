import type {
  ApplyFileChangesInput,
  FileDiagnostic,
  ReadFilesInput
} from '@tinytinkerer/file-tools'

export type MermaidController = {
  readFiles(input: ReadFilesInput): unknown
  applyFileChanges(input: ApplyFileChangesInput): unknown
}
export type MermaidControllerHandle = {
  setController(controller: MermaidController | null): void
  request(method: keyof MermaidController, input: unknown): Promise<unknown>
}
export const createMermaidControllerHandle = (): MermaidControllerHandle => {
  let controller: MermaidController | null = null
  return {
    setController(next) {
      controller = next
    },
    request(method, input) {
      if (!controller) return Promise.reject(new Error('Mermaid workspace is still loading'))
      try {
        return Promise.resolve(controller[method](input as never))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}
export const mermaidControllerHandle = createMermaidControllerHandle()
export type MermaidFileDiagnostic = FileDiagnostic
