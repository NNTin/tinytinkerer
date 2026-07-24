import type { Tool } from '@tinytinkerer/contracts'
import {
  applyFileChangesInputSchema,
  readFilesInputSchema,
  type ApplyFileChangesInput,
  type ReadFilesInput
} from './contracts'
import { summarizeApplyFileChangesActivity, summarizeReadFilesActivity } from './activity'

export type FileToolsHost = {
  readFiles(input: ReadFilesInput): unknown
  applyFileChanges(input: ApplyFileChangesInput): unknown
}

export type CreateFileToolsOptions = {
  readDescription?: string
  applyDescription?: string
}

export const createFileTools = (
  host: FileToolsHost,
  options: CreateFileToolsOptions = {}
): Tool<unknown, unknown>[] => [
  {
    id: 'read_files',
    description:
      options.readDescription ??
      'Read exact file contents and revisions before applying versioned edits.',
    schema: readFilesInputSchema,
    summarizeActivity: summarizeReadFilesActivity,
    execute: (input) => Promise.resolve(host.readFiles(input as ReadFilesInput))
  },
  {
    id: 'apply_file_changes',
    description:
      options.applyDescription ??
      'Atomically create, replace, exact-edit, move, or delete files. Existing files require the revision returned by read_files; conflicts reject the whole batch.',
    schema: applyFileChangesInputSchema,
    summarizeActivity: summarizeApplyFileChangesActivity,
    execute: (input) => Promise.resolve(host.applyFileChanges(input as ApplyFileChangesInput))
  }
]
