import { z } from 'zod'

// --- Event schemas ---

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
  'system',
])

export type EventType = z.infer<typeof eventTypeSchema>

const eventBaseSchema = <TType extends z.ZodTypeAny, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload,
) =>
  z.object({
    id: z.string(),
    timestamp: z.string(),
    type,
    payload,
  })

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})

export type SearchResult = z.infer<typeof searchResultSchema>

export const planComplexitySchema = z.enum(['low', 'medium', 'high'])

export type PlanComplexity = z.infer<typeof planComplexitySchema>

export const planStepSchema = z.object({
  id: z.string(),
  summary: z.string(),
  toolCall: z
    .object({
      toolId: z.string(),
      input: z.record(z.string(), z.unknown()),
    })
    .optional(),
})

export type PlanStep = z.infer<typeof planStepSchema>

export const executionPlanSchema = z.object({
  complexity: planComplexitySchema,
  steps: z.array(planStepSchema),
})

export type ExecutionPlan = z.infer<typeof executionPlanSchema>

export const userMessageEventSchema = eventBaseSchema(
  z.literal('user.message'),
  z.object({ text: z.string() }),
)
export type UserMessageEvent = z.infer<typeof userMessageEventSchema>

export const planningStartedEventSchema = eventBaseSchema(
  z.literal('planning.started'),
  z.object({ summary: z.string() }),
)
export type PlanningStartedEvent = z.infer<typeof planningStartedEventSchema>

export const planGeneratedEventSchema = eventBaseSchema(
  z.literal('plan.generated'),
  z.object({ plan: executionPlanSchema }),
)
export type PlanGeneratedEvent = z.infer<typeof planGeneratedEventSchema>

export const executionStartedEventSchema = eventBaseSchema(
  z.literal('execution.started'),
  z.object({ steps: z.number() }),
)
export type ExecutionStartedEvent = z.infer<typeof executionStartedEventSchema>

export const executionStepStartedEventSchema = eventBaseSchema(
  z.literal('execution.step.started'),
  z.object({ step: planStepSchema, index: z.number() }),
)
export type ExecutionStepStartedEvent = z.infer<typeof executionStepStartedEventSchema>

export const toolCallStartedEventSchema = eventBaseSchema(
  z.literal('tool.call.started'),
  z.object({ toolId: z.string(), input: z.record(z.string(), z.unknown()) }),
)
export type ToolCallStartedEvent = z.infer<typeof toolCallStartedEventSchema>

export const toolCallCompletedEventSchema = eventBaseSchema(
  z.literal('tool.call.completed'),
  z.object({ toolId: z.string(), output: z.unknown() }),
)
export type ToolCallCompletedEvent = z.infer<typeof toolCallCompletedEventSchema>

export const toolCallFailedEventSchema = eventBaseSchema(
  z.literal('tool.call.failed'),
  z.object({ toolId: z.string(), error: z.string() }),
)
export type ToolCallFailedEvent = z.infer<typeof toolCallFailedEventSchema>

export const executionStepCompletedEventSchema = eventBaseSchema(
  z.literal('execution.step.completed'),
  z.object({ stepId: z.string(), note: z.string() }),
)
export type ExecutionStepCompletedEvent = z.infer<typeof executionStepCompletedEventSchema>

export const executionCompletedEventSchema = eventBaseSchema(
  z.literal('execution.completed'),
  z.object({ steps: z.number() }),
)
export type ExecutionCompletedEvent = z.infer<typeof executionCompletedEventSchema>

export const rateLimitWaitingEventSchema = eventBaseSchema(
  z.literal('rate.limit.waiting'),
  z.object({
    retryAfterMs: z.number(),
    retryAt: z.string(),
    message: z.string(),
    autoRetry: z.boolean(),
  }),
)
export type RateLimitWaitingEvent = z.infer<typeof rateLimitWaitingEventSchema>

export const rateLimitRecoveredEventSchema = eventBaseSchema(
  z.literal('rate.limit.recovered'),
  z.object({ retryAt: z.string() }),
)
export type RateLimitRecoveredEvent = z.infer<typeof rateLimitRecoveredEventSchema>

export const rateLimitCancelledEventSchema = eventBaseSchema(
  z.literal('rate.limit.cancelled'),
  z.object({
    retryAfterMs: z.number(),
    retryAt: z.string(),
    message: z.string(),
    reason: z.enum(['too_long', 'cancelled']),
  }),
)
export type RateLimitCancelledEvent = z.infer<typeof rateLimitCancelledEventSchema>

export const assistantChunkEventSchema = eventBaseSchema(
  z.literal('assistant.chunk'),
  z.object({ text: z.string() }),
)
export type AssistantChunkEvent = z.infer<typeof assistantChunkEventSchema>

export const assistantDoneEventSchema = eventBaseSchema(
  z.literal('assistant.done'),
  z.object({ text: z.string() }),
)
export type AssistantDoneEvent = z.infer<typeof assistantDoneEventSchema>

export const errorEventSchema = eventBaseSchema(
  z.literal('error'),
  z.object({ message: z.string() }),
)
export type ErrorEvent = z.infer<typeof errorEventSchema>

export const systemEventSchema = eventBaseSchema(
  z.literal('system'),
  z.object({ message: z.string(), level: z.enum(['info', 'warning', 'error']) }),
)
export type SystemEvent = z.infer<typeof systemEventSchema>

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
  systemEventSchema,
])

export type ChatEvent = z.infer<typeof chatEventSchema>

export const serviceStatusSchema = z.object({
  state: z.enum(['ready', 'degraded', 'offline']),
  detail: z.string(),
  error: z.string().optional(),
})

export type ServiceStatus = z.infer<typeof serviceStatusSchema>

export const systemStatusSchema = z.object({
  auth: serviceStatusSchema,
  models: serviceStatusSchema,
  search: serviceStatusSchema,
})

export type SystemStatus = z.infer<typeof systemStatusSchema>

// --- Edge DTO schemas ---

export const githubExchangeRequestSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url().optional(),
})
export type GithubExchangeRequest = z.infer<typeof githubExchangeRequestSchema>

export const githubExchangeResponseSchema = z.object({
  accessToken: z.string(),
})
export type GithubExchangeResponse = z.infer<typeof githubExchangeResponseSchema>

export const searchRequestSchema = z.object({
  query: z.string().min(2).max(500),
  maxResults: z.number().int().positive().max(10).optional(),
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(32_000),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const chatRequestSchema = z.object({
  model: z.string().optional(),
  stream: z.boolean().optional(),
  messages: z.array(chatMessageSchema).max(100),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export const rateLimitResponseSchema = z.object({
  code: z.literal('rate_limited'),
  error: z.string(),
  retryAfterMs: z.number(),
  retryAt: z.string(),
})
export type RateLimitResponse = z.infer<typeof rateLimitResponseSchema>
