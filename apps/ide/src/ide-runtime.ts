import type { Tool } from '@tinytinkerer/app-browser'
import {
  applyFileChangesInputSchema,
  ideControllerHandle,
  inspectRuntimeInputSchema,
  inspectWorkspaceInputSchema,
  readFilesInputSchema,
  restartRuntimeInputSchema,
  searchFilesInputSchema
} from '@tinytinkerer/ide'

export const createIdeAppTools = (): Tool<unknown, unknown>[] => [
  {
    id: 'inspect_workspace',
    description: 'Inspect the browser IDE file tree, open files, revisions, and runtime status.',
    schema: inspectWorkspaceInputSchema,
    execute: (input) => ideControllerHandle.request('inspectWorkspace', input)
  },
  {
    id: 'search_files',
    description:
      'Search file paths and text in the browser IDE workspace before reading or editing.',
    schema: searchFilesInputSchema,
    execute: (input) => ideControllerHandle.request('searchFiles', input)
  },
  {
    id: 'read_files',
    description:
      'Read exact IDE file contents and revisions. Read before applying versioned edits.',
    schema: readFilesInputSchema,
    execute: (input) => ideControllerHandle.request('readFiles', input)
  },
  {
    id: 'apply_file_changes',
    description:
      'Atomically create, replace, exact-edit, move, or delete IDE files. Existing files require the revision returned by the latest read_files call; conflicts reject the whole batch, so re-read affected files and recompute changes before retrying.',
    schema: applyFileChangesInputSchema,
    execute: (input) => ideControllerHandle.request('applyFileChanges', input)
  },
  {
    id: 'inspect_runtime',
    description:
      'Inspect the Sandpack compile/runtime status, current error, and recent console output.',
    schema: inspectRuntimeInputSchema,
    execute: (input) => ideControllerHandle.request('inspectRuntime', input)
  },
  {
    id: 'restart_runtime',
    description: 'Restart the browser IDE preview after inspecting a runtime problem.',
    schema: restartRuntimeInputSchema,
    execute: (input) => ideControllerHandle.request('restartRuntime', input)
  }
]
