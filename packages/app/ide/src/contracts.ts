import { z } from 'zod'

export {
  applyFileChangesInputSchema,
  fileChangeSchema as ideFileChangeSchema,
  filePathSchema as idePathSchema,
  readFilesInputSchema
} from '@tinytinkerer/file-tools'
export type { ApplyFileChangesInput, FileChange as IdeFileChange } from '@tinytinkerer/file-tools'

export const inspectWorkspaceInputSchema = z.object({})
export const searchFilesInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(100).default(30)
})
export const inspectRuntimeInputSchema = z.object({
  maxLogs: z.number().int().min(1).max(200).default(50)
})
export const restartRuntimeInputSchema = z.object({})

export const IDE_TOOL_IDS = [
  'inspect_workspace',
  'search_files',
  'read_files',
  'apply_file_changes',
  'inspect_runtime',
  'restart_runtime'
] as const
