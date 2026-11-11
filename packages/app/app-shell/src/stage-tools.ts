import type { ActivitySummarizer, Tool } from '@tinytinkerer/app-browser'
import type { StageControllerHandle, StageControllerMethod } from './stage-controller'

export type StageToolRequestHandle<TMethod extends string = string> = {
  request(method: TMethod, input?: unknown): Promise<unknown>
}

export type StageToolDefinition = {
  description: string
  schema: Tool<unknown, unknown>['schema']
  /**
   * Validates what the controller method returns before the model sees it
   * (issue #518, F7). A result that does not match fails the tool call.
   */
  outputSchema?: Tool<unknown, unknown>['outputSchema']
  awaitsHumanInput?: boolean
  summarizeActivity?: ActivitySummarizer
}

export type CreateStageToolsOptions<TMethod extends string = string> = {
  handle: StageToolRequestHandle<TMethod>
  methods: Record<TMethod, StageToolDefinition>
  summarizeActivity?: (method: TMethod) => ActivitySummarizer
}

/**
 * `createStageTools` options keyed by a controller type (issue #518, F7): the
 * method table must name every method of `TController`, and nothing else.
 */
export type CreateControllerStageToolsOptions<TController extends object> = {
  handle: StageControllerHandle<TController>
  methods: Record<StageControllerMethod<TController>, StageToolDefinition>
  summarizeActivity?: (method: StageControllerMethod<TController>) => ActivitySummarizer
}

/**
 * Turns a request handle and a method table into tools, one per method, whose
 * `execute` calls `handle.request(method, input)`.
 *
 * Given a `StageControllerHandle<TController>` (or `TController` explicitly,
 * as `createStageTools<MyController>(…)`), the table is checked against the
 * controller's methods: a missing or unknown method is a type error.
 */
export function createStageTools<TController extends object>(
  options: CreateControllerStageToolsOptions<TController>
): Tool<unknown, unknown>[]
export function createStageTools<TMethod extends string>(
  options: CreateStageToolsOptions<TMethod>
): Tool<unknown, unknown>[]
export function createStageTools({
  handle,
  methods,
  summarizeActivity
}: CreateStageToolsOptions): Tool<unknown, unknown>[] {
  return Object.entries(methods).map(([method, definition]) => {
    const activity = definition.summarizeActivity ?? summarizeActivity?.(method)
    return {
      id: method,
      description: definition.description,
      schema: definition.schema,
      ...(definition.outputSchema ? { outputSchema: definition.outputSchema } : {}),
      ...(definition.awaitsHumanInput ? { awaitsHumanInput: true } : {}),
      ...(activity ? { summarizeActivity: activity } : {}),
      execute: (input: unknown) => handle.request(method, input)
    }
  })
}
