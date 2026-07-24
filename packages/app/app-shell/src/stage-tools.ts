import type { ActivitySummarizer, Tool } from '@tinytinkerer/app-browser'

export type StageToolRequestHandle<TMethod extends string = string> = {
  request(method: TMethod, input?: unknown): Promise<unknown>
}

export type StageToolDefinition = {
  description: string
  schema: Tool<unknown, unknown>['schema']
  awaitsHumanInput?: boolean
  summarizeActivity?: ActivitySummarizer
}

export type CreateStageToolsOptions<TMethod extends string = string> = {
  handle: StageToolRequestHandle<TMethod>
  methods: Record<TMethod, StageToolDefinition>
  summarizeActivity?: (method: TMethod) => ActivitySummarizer
}

export const createStageTools = <TMethod extends string>({
  handle,
  methods,
  summarizeActivity
}: CreateStageToolsOptions<TMethod>): Tool<unknown, unknown>[] =>
  (Object.entries(methods) as Array<[TMethod, StageToolDefinition]>).map(([method, definition]) => {
    const activity = definition.summarizeActivity ?? summarizeActivity?.(method)
    return {
      id: method,
      description: definition.description,
      schema: definition.schema,
      ...(definition.awaitsHumanInput ? { awaitsHumanInput: true } : {}),
      ...(activity ? { summarizeActivity: activity } : {}),
      execute: (input: unknown) => handle.request(method, input)
    }
  })
