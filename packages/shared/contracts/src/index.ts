import { z } from 'zod'
import { contentDocumentSchema } from './content'

export {
  blockNodeSchema,
  contentDocumentSchema,
  inlineNodeSchema,
  listItemNodeSchema,
  nodeIdSchema,
  tableAlignmentSchema,
  tableCellSchema
} from './content'
export type {
  BlockNode,
  BlockquoteNode,
  BreakNode,
  ChoicePromptNode,
  CodeBlockNode,
  CodeInlineNode,
  ContentDocument,
  ContentNode,
  ContentNodeByType,
  EmphasisNode,
  HeadingNode,
  ImageInlineNode,
  ImageNode,
  InlineNode,
  LinkNode,
  ListItemNode,
  ListNode,
  NodeId,
  ParagraphNode,
  StrikethroughNode,
  StrongNode,
  TableAlignment,
  TableCell,
  TableNode,
  TextNode,
  ThematicBreakNode
} from './content'

export const eventTypeSchema = z.enum([
  'user.message',
  // Generic agent-trace events. These describe an agent's reasoning/acting
  // timeline in a strategy-agnostic way so Plan-then-Execute, ReAct, Hybrid,
  // and future agents share one vocabulary. New agents extend the timeline by
  // widening `agentStepKindSchema`, not by adding event types here.
  'agent.run.started',
  'agent.run.completed',
  'agent.step.started',
  'agent.step.delta',
  'agent.step.completed',
  'agent.step.failed',
  'agent.tool.started',
  'agent.tool.completed',
  'agent.tool.failed',
  'rate.limit.waiting',
  'rate.limit.recovered',
  'rate.limit.cancelled',
  'reasoning.chunk',
  'reasoning.done',
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

// Which agent strategy drives a run. Persisted as a user setting and carried on
// `agent.run.started` so the UI (and future tooling) can adapt per strategy.
export const agentTypeSchema = z.enum(['plan-execute', 'react', 'hybrid'])
export type AgentType = z.infer<typeof agentTypeSchema>

// The semantic role of a single step in an agent's trace. Extensible: a new
// agent strategy adds its concepts here without introducing new event types.
export const agentStepKindSchema = z.enum([
  'plan', // created an N-step plan (parent of plan-step children)
  'plan-step', // one step of an upfront plan (Plan-then-Execute / Hybrid)
  'think', // a reasoning/decision step (ReAct / Hybrid thought)
  'act', // taking an action (typically wraps a tool call)
  'observe', // recording an observation/result
  'replan', // Hybrid revising the plan mid-run
  'synthesize' // composing the final answer
])
export type AgentStepKind = z.infer<typeof agentStepKindSchema>

// A single decision in a ReAct loop: either take one concrete action (tool
// call) next, or finish and synthesize the answer.
export const reactDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    reasoning: z.string().optional(),
    toolId: z.string(),
    input: z.record(z.string(), z.unknown())
  }),
  z.object({
    kind: z.literal('final'),
    reasoning: z.string().optional()
  })
])
export type ReActDecision = z.infer<typeof reactDecisionSchema>

const eventBaseSchema = <
  TType extends EventType,
  TPayload extends z.ZodTypeAny
>(
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
export const agentRunStartedEventSchema = eventBaseSchema(
  'agent.run.started',
  z.object({ agentType: agentTypeSchema })
)
export const agentRunCompletedEventSchema = eventBaseSchema(
  'agent.run.completed',
  z.object({ steps: z.number().int().nonnegative() })
)
export const agentStepStartedEventSchema = eventBaseSchema(
  'agent.step.started',
  z.object({
    stepId: z.string(),
    parentStepId: z.string().optional(),
    kind: agentStepKindSchema,
    title: z.string()
  })
)
// Streamed, incrementally-growing text for a step (e.g. a ReAct thought as the
// model emits it). `text` is the full accumulated text so far (last-writer-wins,
// mirroring reasoning.chunk). Live-only: not persisted; the final value is
// carried on the step's agent.step.completed summary for reload.
export const agentStepDeltaEventSchema = eventBaseSchema(
  'agent.step.delta',
  z.object({ stepId: z.string(), text: z.string() })
)
export const agentStepCompletedEventSchema = eventBaseSchema(
  'agent.step.completed',
  z.object({ stepId: z.string(), summary: z.string().optional() })
)
export const agentStepFailedEventSchema = eventBaseSchema(
  'agent.step.failed',
  z.object({ stepId: z.string(), error: z.string() })
)
export const agentToolStartedEventSchema = eventBaseSchema(
  'agent.tool.started',
  z.object({
    stepId: z.string(),
    parentStepId: z.string().optional(),
    toolId: z.string(),
    input: z.record(z.string(), z.unknown())
  })
)
export const agentToolCompletedEventSchema = eventBaseSchema(
  'agent.tool.completed',
  z.object({ stepId: z.string(), toolId: z.string(), output: z.unknown() })
)
export const agentToolFailedEventSchema = eventBaseSchema(
  'agent.tool.failed',
  z.object({ stepId: z.string(), toolId: z.string(), error: z.string() })
)
const rateLimitDetailFields = {
  retryAfterMs: z.number().nonnegative(),
  retryAt: z.string()
} as const

export const rateLimitWaitingEventSchema = eventBaseSchema(
  'rate.limit.waiting',
  z.object({
    ...rateLimitDetailFields,
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
    ...rateLimitDetailFields,
    message: z.string(),
    reason: z.enum(['too_long', 'cancelled'])
  })
)
export const reasoningChunkEventSchema = eventBaseSchema(
  'reasoning.chunk',
  z.object({
    source: z.string(),
    text: z.string()
  })
)
export const reasoningDoneEventSchema = eventBaseSchema(
  'reasoning.done',
  z.object({
    source: z.string(),
    text: z.string()
  })
)
export const assistantChunkEventSchema = eventBaseSchema(
  'assistant.chunk',
  z.object({
    source: z.string(),
    content: contentDocumentSchema
  })
)
export const assistantDoneEventSchema = eventBaseSchema(
  'assistant.done',
  z.object({
    source: z.string(),
    content: contentDocumentSchema
  })
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
  agentRunStartedEventSchema,
  agentRunCompletedEventSchema,
  agentStepStartedEventSchema,
  agentStepDeltaEventSchema,
  agentStepCompletedEventSchema,
  agentStepFailedEventSchema,
  agentToolStartedEventSchema,
  agentToolCompletedEventSchema,
  agentToolFailedEventSchema,
  rateLimitWaitingEventSchema,
  rateLimitRecoveredEventSchema,
  rateLimitCancelledEventSchema,
  reasoningChunkEventSchema,
  reasoningDoneEventSchema,
  assistantChunkEventSchema,
  assistantDoneEventSchema,
  errorEventSchema,
  systemEventSchema
])

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
export type AgentRunStartedEvent = z.infer<typeof agentRunStartedEventSchema>
export type AgentRunCompletedEvent = z.infer<
  typeof agentRunCompletedEventSchema
>
export type AgentStepStartedEvent = z.infer<typeof agentStepStartedEventSchema>
export type AgentStepDeltaEvent = z.infer<typeof agentStepDeltaEventSchema>
export type AgentStepCompletedEvent = z.infer<
  typeof agentStepCompletedEventSchema
>
export type AgentStepFailedEvent = z.infer<typeof agentStepFailedEventSchema>
export type AgentToolStartedEvent = z.infer<typeof agentToolStartedEventSchema>
export type AgentToolCompletedEvent = z.infer<
  typeof agentToolCompletedEventSchema
>
export type AgentToolFailedEvent = z.infer<typeof agentToolFailedEventSchema>
export type RateLimitWaitingEvent = z.infer<typeof rateLimitWaitingEventSchema>
export type RateLimitRecoveredEvent = z.infer<
  typeof rateLimitRecoveredEventSchema
>
export type RateLimitCancelledEvent = z.infer<
  typeof rateLimitCancelledEventSchema
>
export type ReasoningChunkEvent = z.infer<typeof reasoningChunkEventSchema>
export type ReasoningDoneEvent = z.infer<typeof reasoningDoneEventSchema>
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
export type GitHubExchangeResponse = z.infer<
  typeof githubExchangeResponseSchema
>

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

export const brandLinkRelSchema = z.enum([
  'icon',
  'apple-touch-icon',
  'mask-icon'
])
export type BrandLinkRel = z.infer<typeof brandLinkRelSchema>

export const brandLinkAssetSchema = z.object({
  rel: brandLinkRelSchema,
  href: z.string().min(1),
  type: z.string().min(1).optional(),
  sizes: z.string().min(1).optional(),
  color: z.string().min(1).optional()
})
export type BrandLinkAsset = z.infer<typeof brandLinkAssetSchema>

export const brandThemeMetadataSchema = z.object({
  applicationName: z.string().min(1),
  themeColor: z.string().min(1),
  backgroundColor: z.string().min(1)
})
export type BrandThemeMetadata = z.infer<typeof brandThemeMetadataSchema>

export const brandManifestIconPurposeSchema = z.enum([
  'any',
  'maskable',
  'monochrome'
])
export type BrandManifestIconPurpose = z.infer<
  typeof brandManifestIconPurposeSchema
>

export const brandManifestIconSchema = z.object({
  src: z.string().min(1),
  sizes: z.string().min(1),
  type: z.string().min(1),
  purpose: brandManifestIconPurposeSchema.optional()
})
export type BrandManifestIcon = z.infer<typeof brandManifestIconSchema>

export const brandManifestDisplaySchema = z.enum([
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser'
])
export type BrandManifestDisplay = z.infer<typeof brandManifestDisplaySchema>

export const brandManifestSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().min(1),
  description: z.string().min(1).optional(),
  startUrl: z.string().min(1),
  display: brandManifestDisplaySchema,
  backgroundColor: z.string().min(1),
  themeColor: z.string().min(1),
  icons: z.array(brandManifestIconSchema).min(1)
})
export type BrandManifest = z.infer<typeof brandManifestSchema>

export const brandDefinitionSchema = z.object({
  theme: brandThemeMetadataSchema,
  links: z.array(brandLinkAssetSchema).min(1),
  manifest: brandManifestSchema
})
export type BrandDefinition = z.infer<typeof brandDefinitionSchema>

export const chatMessageSchema = z.object({
  role: z.enum(['developer', 'system', 'user', 'assistant']),
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
  ...rateLimitDetailFields
})

export type RateLimitPayload = z.infer<typeof rateLimitPayloadSchema>

export const parseRetryAfterMs = (
  value: string | null | undefined,
  nowMs = Date.now()
): number | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000)
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs)
  }

  return undefined
}

export const githubModelKindSchema = z.enum(['chat', 'embedding'])
export type GitHubModelKind = z.infer<typeof githubModelKindSchema>

export const githubModelLimitsSchema = z.object({
  max_input_tokens: z.number().nullable().optional(),
  max_output_tokens: z.number().nullable().optional()
})
export type GitHubModelLimits = z.infer<typeof githubModelLimitsSchema>

export const githubModelEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: githubModelKindSchema.optional(),
  name: z.string().optional(),
  publisher: z.string().optional(),
  registry: z.string().optional(),
  summary: z.string().optional(),
  html_url: z.string().url().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  limits: githubModelLimitsSchema.optional(),
  rate_limit_tier: z.string().optional(),
  supported_input_modalities: z.array(z.string()).optional(),
  supported_output_modalities: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
})

export const modelsListResponseSchema = z.object({
  models: z.array(githubModelEntrySchema)
})

export type GitHubModelEntry = z.infer<typeof githubModelEntrySchema>
export type ModelsListResponse = z.infer<typeof modelsListResponseSchema>

export const mcpServerConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().url(),
  bearerToken: z.string().optional(),
  enabled: z.boolean()
})

export const mcpToolMetaSchema = z.object({
  toolName: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown())
})

export const mcpDiscoveryResultSchema = z.object({
  serverId: z.string(),
  serverName: z.string(),
  tools: z.array(mcpToolMetaSchema),
  syncedAt: z.string(),
  error: z.string().optional()
})

export const mcpDiscoverRequestSchema = z.object({
  url: z.string(),
  bearerToken: z.string().optional()
})

export const mcpCallRequestSchema = z.object({
  url: z.string(),
  bearerToken: z.string().optional(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown())
})

export const mcpCallResponseSchema = z.object({
  serverName: z.string(),
  toolName: z.string(),
  text: z.string(),
  raw: z.unknown(),
  isError: z.boolean()
})

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>
export type McpToolMeta = z.infer<typeof mcpToolMetaSchema>
export type McpDiscoveryResult = z.infer<typeof mcpDiscoveryResultSchema>
export type McpDiscoverRequest = z.infer<typeof mcpDiscoverRequestSchema>
export type McpCallRequest = z.infer<typeof mcpCallRequestSchema>
export type McpCallResponse = z.infer<typeof mcpCallResponseSchema>

export const TELEMETRY_HEADERS = {
  appVersion: 'X-App-Version',
  buildHash: 'X-Build-Hash',
  installId: 'X-Install-ID',
  githubId: 'X-GitHub-ID'
} as const

// Upper bound on accepted header lengths. App version / build hash are short,
// the install ID is a UUID, and the GitHub id/login is well under this. Caps the
// blast radius of a malicious client stuffing arbitrary values into Sentry.
const TELEMETRY_HEADER_MAX_LENGTH = 128

export const telemetryHeadersSchema = z.object({
  appVersion: z.string().max(TELEMETRY_HEADER_MAX_LENGTH).optional(),
  buildHash: z.string().max(TELEMETRY_HEADER_MAX_LENGTH).optional(),
  installId: z.string().max(TELEMETRY_HEADER_MAX_LENGTH).optional(),
  githubId: z.string().max(TELEMETRY_HEADER_MAX_LENGTH).optional()
})

export type TelemetryHeaders = z.infer<typeof telemetryHeadersSchema>
