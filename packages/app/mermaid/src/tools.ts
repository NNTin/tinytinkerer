import {
  createFileTools,
  type ApplyFileChangesInput,
  type ReadFilesInput
} from '@tinytinkerer/file-tools'
import { mermaidControllerHandle } from './controller'

export const createMermaidAppTools = () =>
  createFileTools(
    {
      readFiles: (input: ReadFilesInput) => mermaidControllerHandle.request('readFiles', input),
      applyFileChanges: (input: ApplyFileChangesInput) =>
        mermaidControllerHandle.request('applyFileChanges', input)
    },
    {
      readDescription:
        'Read the exact Mermaid source at /diagram.mmd, its revision, and any current syntax diagnostic before editing.',
      applyDescription:
        'Revision-safely replace or exact-edit /diagram.mmd. Use the latest read_files revision. The result includes Mermaid syntax diagnostics; if an error is returned, read again and repair it.'
    }
  )
