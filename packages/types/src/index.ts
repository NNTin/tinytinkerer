export type EventType =
  | 'user.message'
  | 'planning.started'
  | 'plan.generated'
  | 'execution.started'
  | 'execution.step.started'
  | 'tool.call.started'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'execution.step.completed'
  | 'rate.limit.waiting'
  | 'rate.limit.recovered'
  | 'rate.limit.cancelled'
  | 'assistant.chunk'
  | 'assistant.done'
  | 'error'
  | 'system'

export type EventBase<TType extends EventType, TPayload> = {
  id: string
  timestamp: string
  type: TType
  payload: TPayload
}

export type SearchResult = {
  title: string
  url: string
  snippet: string
}

export type PlanComplexity = 'low' | 'medium' | 'high'

export type PlanStep = {
  id: string
  summary: string
  toolCall?: {
    toolId: string
    input: Record<string, unknown>
  } | undefined
}

export type ExecutionPlan = {
  complexity: PlanComplexity
  steps: PlanStep[]
}

export type UserMessageEvent = EventBase<'user.message', { text: string }>
export type PlanningStartedEvent = EventBase<'planning.started', { summary: string }>
export type PlanGeneratedEvent = EventBase<'plan.generated', { plan: ExecutionPlan }>
export type ExecutionStartedEvent = EventBase<'execution.started', { steps: number }>
export type ExecutionStepStartedEvent = EventBase<
  'execution.step.started',
  { step: PlanStep; index: number }
>
export type ToolCallStartedEvent = EventBase<
  'tool.call.started',
  { toolId: string; input: Record<string, unknown> }
>
export type ToolCallCompletedEvent = EventBase<
  'tool.call.completed',
  { toolId: string; output: unknown }
>
export type ToolCallFailedEvent = EventBase<
  'tool.call.failed',
  { toolId: string; error: string }
>
export type ExecutionStepCompletedEvent = EventBase<
  'execution.step.completed',
  { stepId: string; note: string }
>
export type RateLimitWaitingEvent = EventBase<
  'rate.limit.waiting',
  { retryAfterMs: number; retryAt: string; message: string; autoRetry: boolean }
>
export type RateLimitRecoveredEvent = EventBase<'rate.limit.recovered', { retryAt: string }>
export type RateLimitCancelledEvent = EventBase<
  'rate.limit.cancelled',
  { retryAfterMs: number; retryAt: string; message: string; reason: 'too_long' | 'cancelled' }
>
export type AssistantChunkEvent = EventBase<'assistant.chunk', { text: string }>
export type AssistantDoneEvent = EventBase<'assistant.done', { text: string }>
export type ErrorEvent = EventBase<'error', { message: string }>
export type SystemEvent = EventBase<'system', { message: string; level: 'info' | 'warning' | 'error' }>

export type ChatEvent =
  | UserMessageEvent
  | PlanningStartedEvent
  | PlanGeneratedEvent
  | ExecutionStartedEvent
  | ExecutionStepStartedEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | ToolCallFailedEvent
  | ExecutionStepCompletedEvent
  | RateLimitWaitingEvent
  | RateLimitRecoveredEvent
  | RateLimitCancelledEvent
  | AssistantChunkEvent
  | AssistantDoneEvent
  | ErrorEvent
  | SystemEvent

export type ServiceStatus = {
  state: 'ready' | 'degraded' | 'offline'
  detail: string
  error?: string
}

export type SystemStatus = {
  auth: ServiceStatus
  models: ServiceStatus
  search: ServiceStatus
}
