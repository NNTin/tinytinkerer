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

// Edge API contracts — schemas, inferred types, and route/header constants.
// These are hand-authored in ./edge and are the source of truth: the edge app
// builds its routes from them and emits the published OpenAPI document
// (apps/edge/openapi/tinytinkerer-edge.openapi.json) from the code. Do not
// redefine these names here.
export * from './edge'

// Plugin contracts — feedback tool input + plugin activation state.
export * from './plugins'

// Canonical Zod → JSON Schema path for tool descriptors and strict model-output
// payloads (issue #287). The single source of truth for a tool's input shape is
// its Zod schema; the planner-facing JSON Schema is generated, never duplicated.
export * from './tool-schema'

// Host↔plugin presentation view-models (status gauge + context inspector). Split
// out of ./plugins to contain its growth; still the host↔plugin boundary contract,
// so it stays in contracts (the only layer the host can import). See ./plugin-views.
export * from './plugin-views'

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
  // Token usage reported by the model provider for the most recent model call
  // (LiteLLM `usage` with `stream_options.include_usage`). Optional/best-effort:
  // emitted only when the provider surfaces it, and consumed by the context-usage
  // gauge plugin. Absence is normal and simply leaves the gauge hidden.
  'agent.usage',
  'error',
  'system'
])

export type EventType = z.infer<typeof eventTypeSchema>

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

// Strict structured-output WIRE schema for the planner (issue #287). The runtime
// `executionPlanSchema` above is NOT directly usable as an OpenAI `strict:true`
// `response_format`: strict mode forbids open objects (every object must be closed
// with `additionalProperties:false` and list all keys as `required`), but a tool's
// arguments (`toolCall.input`) are an arbitrary per-tool bag. So, exactly as native
// tool calling carries `arguments` as a JSON-encoded STRING (issue #276), the wire
// plan carries `toolCall.input` as a JSON string. `toolCall` is `.nullable()` (not
// `.optional()`) so it stays a required-but-nullable field — strict-valid — and the
// model emits `null` when a step takes no action. This schema is the source for the
// json_schema sent to the provider; `executionPlanFromWire` maps it back to the
// runtime `ExecutionPlan`, which is then re-validated against `executionPlanSchema`
// (the authoritative backstop).
const planToolCallWireSchema = z.object({
  toolId: z.string().describe('Exact tool id to call'),
  input: z
    .string()
    .describe('JSON-encoded object of the tool arguments (e.g. {"query":"…"}); use {} for none')
})

const planStepWireSchema = z.object({
  id: z.string().describe('Unique step id'),
  summary: z.string().describe('What this step does'),
  toolCall: planToolCallWireSchema
    .nullable()
    .describe('The tool to invoke for this step, or null when the step calls no tool')
})

export const executionPlanWireSchema = z.object({
  complexity: planComplexitySchema,
  steps: z.array(planStepWireSchema)
})

export type ExecutionPlanWire = z.infer<typeof executionPlanWireSchema>

// Parse a tool call's JSON-encoded `input` string into an arguments object. A
// missing/blank/invalid value yields `{}` — the tool's own Zod schema validates the
// arguments at execution, so a malformed bag fails there (where the agent can
// correct it), not here. Mirrors parseToolCallArguments in the native tool-call
// path (issue #276) so the two cannot diverge.
const parsePlanToolInput = (inputJson: string): Record<string, unknown> => {
  if (!inputJson || inputJson.trim().length === 0) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(inputJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// Map the strict wire plan back to the runtime ExecutionPlan: decode each step's
// JSON-string `input` into an arguments object and drop a null `toolCall` (so the
// runtime sees an action-less step, matching `toolCall?` optional semantics). The
// caller re-validates the result against `executionPlanSchema`.
export const executionPlanFromWire = (wire: ExecutionPlanWire): ExecutionPlan => ({
  complexity: wire.complexity,
  steps: wire.steps.map((step) => ({
    id: step.id,
    summary: step.summary,
    ...(step.toolCall
      ? {
          toolCall: { toolId: step.toolCall.toolId, input: parsePlanToolInput(step.toolCall.input) }
        }
      : {})
  }))
})

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

// Whether a ReAct decision takes another action or finishes and answers. Shared
// by the decision schema below and the step events that surface the decision on
// the timeline (so the UI can colour/label the step by kind).
export const reactDecisionKindSchema = z.enum(['action', 'final'])
export type ReActDecisionKind = z.infer<typeof reactDecisionKindSchema>

// A single decision in a ReAct loop: either take one concrete action (tool
// call) next, or finish and synthesize the answer.
export const reactDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    // Genuine model prose only (the model's "why"); omitted when the model emits
    // none. Never a host-derived display label — presentation is the timeline's
    // concern, not the decision's (issue #276 arch-review follow-up).
    reasoning: z.string().optional(),
    toolId: z.string(),
    input: z.record(z.string(), z.unknown())
  }),
  z.object({
    kind: z.literal('final'),
    // See the action variant: genuine model prose only, omitted when absent.
    reasoning: z.string().optional()
  })
])
export type ReActDecision = z.infer<typeof reactDecisionSchema>

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
    title: z.string(),
    // The kind (action vs final) of the ReAct decision this step resolved to, so
    // the timeline can colour/label the step. Optional and only set by paths where
    // the decision is known when the step opens (the non-streaming ReAct decision);
    // the streaming path carries it on agent.step.completed once the decision
    // resolves. The model's prose rides on `title`/the streamed thought (the step
    // label), not on a separate field (issue #276 arch-review follow-up).
    decisionKind: reactDecisionKindSchema.optional()
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
  z.object({
    stepId: z.string(),
    summary: z.string().optional(),
    // The kind of the ReAct decision this step resolved to (see
    // agentStepStartedEventSchema). The streaming decision path sets it the moment
    // the decision resolves at end-of-stream, so the timeline surfaces the kind
    // live (and it persists via this completed event on reload). The model's prose
    // rides on `summary` (the step label), not a separate field (issue #276).
    decisionKind: reactDecisionKindSchema.optional()
  })
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
// Token usage for the most recent model call. `promptTokens` is the input-side
// token count the context-usage gauge compares against the model's context
// window; completion/total are carried for completeness. Best-effort: emitted
// only when the provider reports usage.
export const agentUsageEventSchema = eventBaseSchema(
  'agent.usage',
  z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional()
  })
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
export const errorEventSchema = eventBaseSchema('error', z.object({ message: z.string() }))
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
  agentUsageEventSchema,
  errorEventSchema,
  systemEventSchema
])

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
export type AgentRunStartedEvent = z.infer<typeof agentRunStartedEventSchema>
export type AgentRunCompletedEvent = z.infer<typeof agentRunCompletedEventSchema>
export type AgentStepStartedEvent = z.infer<typeof agentStepStartedEventSchema>
export type AgentStepDeltaEvent = z.infer<typeof agentStepDeltaEventSchema>
export type AgentStepCompletedEvent = z.infer<typeof agentStepCompletedEventSchema>
export type AgentStepFailedEvent = z.infer<typeof agentStepFailedEventSchema>
export type AgentToolStartedEvent = z.infer<typeof agentToolStartedEventSchema>
export type AgentToolCompletedEvent = z.infer<typeof agentToolCompletedEventSchema>
export type AgentToolFailedEvent = z.infer<typeof agentToolFailedEventSchema>
export type RateLimitWaitingEvent = z.infer<typeof rateLimitWaitingEventSchema>
export type RateLimitRecoveredEvent = z.infer<typeof rateLimitRecoveredEventSchema>
export type RateLimitCancelledEvent = z.infer<typeof rateLimitCancelledEventSchema>
export type ReasoningChunkEvent = z.infer<typeof reasoningChunkEventSchema>
export type ReasoningDoneEvent = z.infer<typeof reasoningDoneEventSchema>
export type AssistantChunkEvent = z.infer<typeof assistantChunkEventSchema>
export type AssistantDoneEvent = z.infer<typeof assistantDoneEventSchema>
export type AgentUsageEvent = z.infer<typeof agentUsageEventSchema>
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type SystemEvent = z.infer<typeof systemEventSchema>
export type ChatEvent = z.infer<typeof chatEventSchema>

export const brandLinkRelSchema = z.enum(['icon', 'apple-touch-icon', 'mask-icon'])
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

export const brandManifestIconPurposeSchema = z.enum(['any', 'maskable', 'monochrome'])
export type BrandManifestIconPurpose = z.infer<typeof brandManifestIconPurposeSchema>

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
