import { z } from 'zod'

export const idePathSchema = z
  .string()
  .min(2)
  .max(512)
  .regex(/^\/(?!.*(?:^|\/)\.\.?\/)(?!.*\/\/)[^\0]+$/, 'path must be canonical and absolute')

export const inspectWorkspaceInputSchema = z.object({})
export const searchFilesInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(100).default(30)
})
export const readFilesInputSchema = z.object({
  paths: z.array(idePathSchema).min(1).max(50)
})

const createChangeSchema = z.object({
  kind: z.literal('create'),
  path: idePathSchema,
  content: z.string().max(1_000_000)
})
const replaceChangeSchema = z.object({
  kind: z.literal('replace'),
  path: idePathSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().max(1_000_000)
})
const editChangeSchema = z.object({
  kind: z.literal('edit'),
  path: idePathSchema,
  expectedRevision: z.number().int().nonnegative(),
  oldText: z.string().min(1).max(500_000),
  newText: z.string().max(500_000),
  replaceAll: z.boolean().default(false)
})
const moveChangeSchema = z.object({
  kind: z.literal('move'),
  path: idePathSchema,
  destination: idePathSchema,
  expectedRevision: z.number().int().nonnegative()
})
const deleteChangeSchema = z.object({
  kind: z.literal('delete'),
  path: idePathSchema,
  expectedRevision: z.number().int().nonnegative()
})

export const ideFileChangeSchema = z.discriminatedUnion('kind', [
  createChangeSchema,
  replaceChangeSchema,
  editChangeSchema,
  moveChangeSchema,
  deleteChangeSchema
])
export const applyFileChangesInputSchema = z.object({
  changes: z.array(ideFileChangeSchema).min(1).max(50)
})
export const inspectRuntimeInputSchema = z.object({
  maxLogs: z.number().int().min(1).max(200).default(50)
})
export const restartRuntimeInputSchema = z.object({})

export type IdeFileChange = z.infer<typeof ideFileChangeSchema>
export type ApplyFileChangesInput = z.infer<typeof applyFileChangesInputSchema>

export const IDE_TOOL_IDS = [
  'inspect_workspace',
  'search_files',
  'read_files',
  'apply_file_changes',
  'inspect_runtime',
  'restart_runtime'
] as const
