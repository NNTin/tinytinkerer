import { z } from 'zod'

export const filePathSchema = z
  .string()
  .min(2)
  .max(512)
  .regex(/^\/(?!.*(?:^|\/)\.\.?\/)(?!.*\/\/)[^\0]+$/, 'path must be canonical and absolute')

export const readFilesInputSchema = z.object({
  paths: z.array(filePathSchema).min(1).max(50)
})

export const createFileChangeSchema = z.object({
  kind: z.literal('create'),
  path: filePathSchema,
  content: z.string().max(1_000_000)
})
export const replaceFileChangeSchema = z.object({
  kind: z.literal('replace'),
  path: filePathSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().max(1_000_000)
})
export const editFileChangeSchema = z.object({
  kind: z.literal('edit'),
  path: filePathSchema,
  expectedRevision: z.number().int().nonnegative(),
  oldText: z.string().min(1).max(500_000),
  newText: z.string().max(500_000),
  replaceAll: z.boolean().default(false)
})
export const moveFileChangeSchema = z.object({
  kind: z.literal('move'),
  path: filePathSchema,
  destination: filePathSchema,
  expectedRevision: z.number().int().nonnegative()
})
export const deleteFileChangeSchema = z.object({
  kind: z.literal('delete'),
  path: filePathSchema,
  expectedRevision: z.number().int().nonnegative()
})

export const fileChangeSchema = z.discriminatedUnion('kind', [
  createFileChangeSchema,
  replaceFileChangeSchema,
  editFileChangeSchema,
  moveFileChangeSchema,
  deleteFileChangeSchema
])
export const applyFileChangesInputSchema = z.object({
  changes: z.array(fileChangeSchema).min(1).max(50)
})

export type FileChange = z.infer<typeof fileChangeSchema>
export type ApplyFileChangesInput = z.infer<typeof applyFileChangesInputSchema>
export type ReadFilesInput = z.infer<typeof readFilesInputSchema>

export type FileDiagnostic = {
  path: string
  severity: 'error' | 'warning'
  message: string
  line?: number
  column?: number
}

export type ReadFileRecord = { path: string; content: string; revision: number }
export type ReadFilesResult = { files: ReadFileRecord[]; diagnostics?: FileDiagnostic[] }
export type FileChangeReceipt = { path: string; deleted: boolean; revision?: number }
export type ApplyFileChangesResult = {
  workspaceRevision: number
  changes: FileChangeReceipt[]
  diagnostics?: FileDiagnostic[]
}

export const FILE_TOOL_IDS = ['read_files', 'apply_file_changes'] as const
