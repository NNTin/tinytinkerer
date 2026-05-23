import { z } from 'zod'

export const eventTypeSchema = z.enum([
  'user.message',
  'planning.started',
  'plan.generated',
  'execution.started',
  'execution.step.started',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'execution.step.completed',
  'execution.completed',
  'rate.limit.waiting',
  'rate.limit.recovered',
  'rate.limit.cancelled',
  'assistant.chunk',
  'assistant.done',
  'error',
  'system'
])

export type EventType = z.infer<typeof eventTypeSchema>

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string()
})

export type SearchResult = z.infer<typeof searchResultSchema>

export const planComplexitySchema = z.enum(['low', 'medium', 'high'])
export type PlanComplexity = z.infer<typeof planComplexitySchema>

export const toolCallSchema = z.object({
  toolId: z.string(),
  input: z.record(z.string(), z.unknown())
})

export const planStepSchema = z.object({
  id: z.string(),
  summary: z.string(),
  toolCall: toolCallSchema.optional()
})

export type PlanStep = z.infer<typeof planStepSchema>

export const executionPlanSchema = z.object({
  complexity: planComplexitySchema,
  steps: z.array(planStepSchema)
})

export type ExecutionPlan = z.infer<typeof executionPlanSchema>

const eventBaseSchema = <TType extends EventType, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload
) =>
  z.object({
    id: z.string(),
    timestamp: z.string(),
    type: z.literal(type),
    payload
  })

export const userMessageEventSchema = eventBaseSchema(
  'user.message',
  z.object({ text: z.string() })
)
export const planningStartedEventSchema = eventBaseSchema(
  'planning.started',
  z.object({ summary: z.string() })
)
export const planGeneratedEventSchema = eventBaseSchema(
  'plan.generated',
  z.object({ plan: executionPlanSchema })
)
export const executionStartedEventSchema = eventBaseSchema(
  'execution.started',
  z.object({ steps: z.number().int().nonnegative() })
)
export const executionStepStartedEventSchema = eventBaseSchema(
  'execution.step.started',
  z.object({ step: planStepSchema, index: z.number().int().nonnegative() })
)
export const toolCallStartedEventSchema = eventBaseSchema(
  'tool.call.started',
  z.object({ toolId: z.string(), input: z.record(z.string(), z.unknown()) })
)
export const toolCallCompletedEventSchema = eventBaseSchema(
  'tool.call.completed',
  z.object({ toolId: z.string(), output: z.unknown() })
)
export const toolCallFailedEventSchema = eventBaseSchema(
  'tool.call.failed',
  z.object({ toolId: z.string(), error: z.string() })
)
export const executionStepCompletedEventSchema = eventBaseSchema(
  'execution.step.completed',
  z.object({ stepId: z.string(), note: z.string() })
)
export const executionCompletedEventSchema = eventBaseSchema(
  'execution.completed',
  z.object({ steps: z.number().int().nonnegative() })
)
export const rateLimitWaitingEventSchema = eventBaseSchema(
  'rate.limit.waiting',
  z.object({
    retryAfterMs: z.number().nonnegative(),
    retryAt: z.string(),
    message: z.string(),
    autoRetry: z.boolean()
  })
)
export const rateLimitRecoveredEventSchema = eventBaseSchema(
  'rate.limit.recovered',
  z.object({ retryAt: z.string() })
)
export const rateLimitCancelledEventSchema = eventBaseSchema(
  'rate.limit.cancelled',
  z.object({
    retryAfterMs: z.number().nonnegative(),
    retryAt: z.string(),
    message: z.string(),
    reason: z.enum(['too_long', 'cancelled'])
  })
)
export const assistantChunkEventSchema = eventBaseSchema(
  'assistant.chunk',
  z.object({ text: z.string() })
)
export const assistantDoneEventSchema = eventBaseSchema(
  'assistant.done',
  z.object({ text: z.string() })
)
export const errorEventSchema = eventBaseSchema(
  'error',
  z.object({ message: z.string() })
)
export const systemEventSchema = eventBaseSchema(
  'system',
  z.object({
    message: z.string(),
    level: z.enum(['info', 'warning', 'error'])
  })
)

export const chatEventSchema = z.discriminatedUnion('type', [
  userMessageEventSchema,
  planningStartedEventSchema,
  planGeneratedEventSchema,
  executionStartedEventSchema,
  executionStepStartedEventSchema,
  toolCallStartedEventSchema,
  toolCallCompletedEventSchema,
  toolCallFailedEventSchema,
  executionStepCompletedEventSchema,
  executionCompletedEventSchema,
  rateLimitWaitingEventSchema,
  rateLimitRecoveredEventSchema,
  rateLimitCancelledEventSchema,
  assistantChunkEventSchema,
  assistantDoneEventSchema,
  errorEventSchema,
  systemEventSchema
])

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
export type PlanningStartedEvent = z.infer<typeof planningStartedEventSchema>
export type PlanGeneratedEvent = z.infer<typeof planGeneratedEventSchema>
export type ExecutionStartedEvent = z.infer<typeof executionStartedEventSchema>
export type ExecutionStepStartedEvent = z.infer<typeof executionStepStartedEventSchema>
export type ToolCallStartedEvent = z.infer<typeof toolCallStartedEventSchema>
export type ToolCallCompletedEvent = z.infer<typeof toolCallCompletedEventSchema>
export type ToolCallFailedEvent = z.infer<typeof toolCallFailedEventSchema>
export type ExecutionStepCompletedEvent = z.infer<typeof executionStepCompletedEventSchema>
export type ExecutionCompletedEvent = z.infer<typeof executionCompletedEventSchema>
export type RateLimitWaitingEvent = z.infer<typeof rateLimitWaitingEventSchema>
export type RateLimitRecoveredEvent = z.infer<typeof rateLimitRecoveredEventSchema>
export type RateLimitCancelledEvent = z.infer<typeof rateLimitCancelledEventSchema>
export type AssistantChunkEvent = z.infer<typeof assistantChunkEventSchema>
export type AssistantDoneEvent = z.infer<typeof assistantDoneEventSchema>
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type SystemEvent = z.infer<typeof systemEventSchema>
export type ChatEvent = z.infer<typeof chatEventSchema>

export const serviceStatusSchema = z.object({
  state: z.enum(['ready', 'degraded', 'offline']),
  detail: z.string(),
  error: z.string().optional()
})

export type ServiceStatus = z.infer<typeof serviceStatusSchema>

export const systemStatusSchema = z.object({
  auth: serviceStatusSchema,
  models: serviceStatusSchema,
  search: serviceStatusSchema
})

export type SystemStatus = z.infer<typeof systemStatusSchema>

export const githubExchangeRequestSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url().optional()
})

export const githubExchangeResponseSchema = z.object({
  accessToken: z.string().optional(),
  error: z.string().optional()
})

export type GitHubExchangeRequest = z.infer<typeof githubExchangeRequestSchema>
export type GitHubExchangeResponse = z.infer<typeof githubExchangeResponseSchema>

export const edgeErrorResponseSchema = z.object({
  error: z.string()
})

export type EdgeErrorResponse = z.infer<typeof edgeErrorResponseSchema>

export const searchRequestSchema = z.object({
  query: z.string().min(2).max(500),
  maxResults: z.number().int().positive().max(10).optional()
})

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema)
})

export type SearchRequest = z.infer<typeof searchRequestSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(32_000)
})

export const modelsChatRequestSchema = z.object({
  model: z.string().optional(),
  stream: z.boolean().optional(),
  messages: z.array(chatMessageSchema).max(100)
})

export const modelsChatChoiceSchema = z.object({
  message: z
    .object({
      role: z.string().optional(),
      content: z.string().nullable().optional()
    })
    .optional(),
  finish_reason: z.string().optional()
})

export const modelsChatResponseSchema = z.object({
  choices: z.array(modelsChatChoiceSchema).optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional()
    })
    .optional()
})

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ModelsChatRequest = z.infer<typeof modelsChatRequestSchema>
export type ModelsChatResponse = z.infer<typeof modelsChatResponseSchema>

export const rateLimitPayloadSchema = z.object({
  code: z.literal('rate_limited'),
  error: z.string(),
  retryAfterMs: z.number().nonnegative(),
  retryAt: z.string()
})

export type RateLimitPayload = z.infer<typeof rateLimitPayloadSchema>
