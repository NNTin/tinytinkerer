import { createStageControllerHandle } from '@tinytinkerer/app-shell'
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
  return createStageControllerHandle<MermaidController>('Mermaid workspace is still loading')
}
export const mermaidControllerHandle = createMermaidControllerHandle()
export type MermaidFileDiagnostic = FileDiagnostic
