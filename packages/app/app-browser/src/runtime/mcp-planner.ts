import { parseJsonWithTelemetry, parseModelJsonWithTelemetry } from '../telemetry/request-telemetry'
import type { ConversationMessage } from '@tinytinkerer/app-core'
import {
  executionPlanFromWire,
  executionPlanSchema,
  executionPlanWireSchema,
  toStrictResponseJsonSchema,
  type ExecutionPlan,
  type ExecutionPlanWire,
  type KeywordPlannerStep,
  type ResponseFormat
} from '@tinytinkerer/contracts'
import { createEdgeError, type ModelsChatFetch } from './edge-fetch'
import { createRateLimitError } from './rate-limit'
import { buildToolNameMap, type ToolNameMap } from './tool-calling'

export type PlannerToolDescriptor = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
  // Optional keyword-fallback step the tool's owner declared. Carried so the
  // heuristic planner (app-core's inferPlan) can propose the tool without the host
  // naming any concrete tool id. See KeywordPlannerStep.
  keywordPlannerStep?: KeywordPlannerStep
}

// Name of the structured-output schema sent in `response_format` (issue #287).
const EXECUTION_PLAN_SCHEMA_NAME = 'execution_plan'

// Tools are advertised NATIVELY on the request (the `tools` array — the same
// `buildToolNameMap` definitions the ReAct decider/synthesizer send), so the model
// reads each tool's name, description, and parameter schema from the tool list, not
// a hand-built prompt catalogue. The OUTPUT SHAPE is enforced by the json_schema
// `response_format` (issue #287). Two wire details the tool list / schema can't
// convey: a step's `toolCall.input` is a JSON-ENCODED STRING (the strict-mode
// workaround for arbitrary per-tool arguments, mirroring native tool-call
// `arguments`), and `toolCall.toolId` is the advertised tool name.
const buildPlanningSystemPrompt = (): string =>
  `You are a planning assistant. Given the user prompt and conversation history, produce an execution plan using the tools available to you.

Rules:
- Start with an "understand" step and end with a "compose" step.
- Give a step a "toolCall" whenever a tool would be more reliable than doing it by hand (exact calculation, parsing, fetching); use null when no tool would help.
- "toolCall.toolId" must be the exact name of an available tool.
- "toolCall.input" is a JSON-encoded STRING of that tool's arguments object (e.g. "{\\"query\\":\\"…\\"}"), or "{}" when none; it must match the tool's parameters.`

// The model addresses a tool by its advertised (wire-safe) name, exactly like the
// ReAct decider. Map each planned step's `toolId` back to the real runtime tool id
// (the reverse of buildToolNameMap, NOT a lossy regex round-trip) so the executor
// resolves it in the registry — mirroring react-decider's toActionDecision. A name
// the map doesn't know falls through unchanged; the registry is the real gate.
const resolvePlanToolIds = (wire: ExecutionPlanWire, names: ToolNameMap): ExecutionPlanWire => ({
  ...wire,
  steps: wire.steps.map((step) =>
    step.toolCall
      ? { ...step, toolCall: { ...step.toolCall, toolId: names.toToolId(step.toolCall.toolId) } }
      : step
  )
})

// The structured-output request (issue #287): ask the provider to enforce the
// ExecutionPlan shape at generation via a strict json_schema generated from the
// canonical wire schema. `strict: true` (the maintainer's decision) hard-enforces
// the closed, all-required wire shape; the post-parse against the Zod schema below
// stays the authoritative backstop for providers whose json_schema support is
// partial.
const executionPlanResponseFormat = (): ResponseFormat => ({
  type: 'json_schema',
  json_schema: {
    name: EXECUTION_PLAN_SCHEMA_NAME,
    schema: toStrictResponseJsonSchema(executionPlanWireSchema),
    strict: true
  }
})

export const llmPlan = async (
  prompt: string,
  history: ConversationMessage[],
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  signal?: AbortSignal
): Promise<ExecutionPlan> => {
  const systemPrompt = buildPlanningSystemPrompt()
  const names = buildToolNameMap(tools)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt }
  ]

  const response = await modelsChat(
    {
      model,
      stream: false,
      messages,
      // Advertise the tools natively (the same definitions the decider sends) so the
      // planner reads each tool's name/description/parameters from the tool list.
      // `tool_choice: 'none'` forbids native tool_calls — the plan comes back as
      // structured output via `response_format`, not as calls (issue #287).
      ...(names.definitions.length > 0
        ? { tools: names.definitions, tool_choice: 'none' as const }
        : {}),
      response_format: executionPlanResponseFormat()
    },
    {
      area: 'planning.chat',
      ...(signal ? { signal } : {})
    }
  )

  if (!response.ok) {
    if (response.status === 429) {
      throw await createRateLimitError(response)
    }
    // Preserve the edge's structured error message rather than a bare status
    // (issue #287 — arch review finding E). A provider behind LiteLLM that rejects
    // the strict `response_format` answers a non-429 error here; surfacing its
    // actual reason (not just "failed (400)") means the run-error path reports the
    // real cause to Sentry via the runtime's reportError sink, so a structured-
    // output incompatibility is diagnosable instead of an opaque failure. Matches
    // the ReAct decider and synthesizer, which already build errors this way.
    throw await createEdgeError(response, `Planning request failed (${response.status})`)
  }

  const metadata = {
    area: 'planning.chat' as const,
    origin: 'edge' as const,
    method: 'POST',
    url: response.url,
    model,
    stream: false
  }
  const data = await parseJsonWithTelemetry<{
    choices?: Array<{ message?: { content?: string | null } }>
  }>(metadata, response)
  const text = data.choices?.[0]?.message?.content ?? ''

  // The provider was asked to enforce the plan shape via `response_format`
  // (json_schema, strict) — but LiteLLM-proxied providers vary in support, so the
  // CONTENT is still the authoritative gate: validate it against the canonical wire
  // schema (issue #287). The wire shape carries `toolCall.input` as a JSON STRING
  // (the strict-mode workaround for arbitrary tool arguments). Unlike the ReAct
  // decider (which recovers to a `final` answer), the planner has no safe local
  // fallback — a wrong/guessed plan is worse than a clear failure — so an
  // unrecoverable parse/schema failure throws a ModelJsonError the caller surfaces
  // to the run-error path rather than silently degrading.
  const wirePlan = parseModelJsonWithTelemetry(
    metadata,
    text,
    executionPlanWireSchema,
    {
      parseError: 'Planning response body was not valid JSON',
      schemaError: 'Planning response did not match execution plan schema'
    },
    response
  )

  // Resolve each step's advertised (wire-safe) tool name back to the real runtime
  // tool id, then map the strict wire plan (string-encoded tool inputs) back to the
  // runtime ExecutionPlan and re-validate against the canonical schema — the single
  // contract every downstream consumer (executor, inspector, timeline) relies on.
  return executionPlanSchema.parse(executionPlanFromWire(resolvePlanToolIds(wirePlan, names)))
}
