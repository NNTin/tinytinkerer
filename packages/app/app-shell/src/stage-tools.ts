import type { Tool } from '@tinytinkerer/app-browser'

export type StageToolRequestHandle = {
  request(method: string, input?: unknown): Promise<unknown>
}

export type StageToolDefinition = {
  description: string
  schema: Tool<unknown, unknown>['schema']
  awaitsHumanInput?: boolean
}

export type CreateStageToolsOptions = {
  handle: StageToolRequestHandle
  methods: Record<string, StageToolDefinition>
}

export const createStageTools = ({
  handle,
  methods
}: CreateStageToolsOptions): Tool<unknown, unknown>[] =>
  Object.entries(methods).map(([method, definition]) => ({
    id: method,
    description: definition.description,
    schema: definition.schema,
    ...(definition.awaitsHumanInput ? { awaitsHumanInput: true } : {}),
    execute: (input: unknown) => handle.request(method, input)
  }))
