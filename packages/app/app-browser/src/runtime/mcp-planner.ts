import { parseJsonWithTelemetry, parseModelJsonWithTelemetry } from '../telemetry/request-telemetry'
import type { ConversationMessage } from '@tinytinkerer/app-core'
import {
  executionPlanFromWire,
  executionPlanSchema,
  executionPlanWireSchema,
  toStrictResponseJsonSchema,
  type ExecutionPlan,
  type KeywordPlannerStep,
  type ResponseFormat
} from '@tinytinkerer/contracts'
import type { ModelsChatFetch } from './edge-fetch'
import { createRateLimitError } from './rate-limit'

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

const buildPlanningSystemPrompt = (tools: PlannerToolDescriptor[]): string => {
  const toolDocs = tools
    .map(
      (t) =>
        `Tool: ${t.id}\nDescription: ${t.description}\nInput schema: ${JSON.stringify(t.inputSchema, null, 2)}`
    )
    .join('\n\n')

  // The OUTPUT SHAPE is enforced by the json_schema `response_format` (issue #287),
  // so the prompt no longer hand-describes the JSON envelope or begs for "ONLY
  // JSON" — it states the planning task and the tool catalogue. One wire detail the
  // schema can't convey: a step's `toolCall.input` is a JSON-ENCODED STRING (the
  // strict-mode workaround for arbitrary per-tool arguments, mirroring native
  // tool-call `arguments`), so the model must stringify the arguments object.
  return `You are a planning assistant. Given a user prompt and conversation history, produce an execution plan.

Available tools:
${toolDocs}

Rules:
- Always include an "understand" step first and a "compose" step last.
- Give a step a "toolCall" whenever a tool would give a more reliable result than working it out by hand — e.g. exact calculation, parsing, or fetching information; use null only when no available tool would help that step.
- Use exact tool IDs from the list above.
- "toolCall.input" is a JSON-encoded STRING of the tool's arguments object (e.g. "{\\"query\\":\\"…\\"}"); use "{}" when the tool needs no arguments.
- Arguments must match the named tool's input schema.`
}

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
  const systemPrompt = buildPlanningSystemPrompt(tools)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt }
  ]

  const response = await modelsChat(
    { model, stream: false, messages, response_format: executionPlanResponseFormat() },
    {
      area: 'planning.chat',
      ...(signal ? { signal } : {})
    }
  )

  if (!response.ok) {
    if (response.status === 429) {
      throw await createRateLimitError(response)
    }
    throw new Error(`Planning request failed (${response.status})`)
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

  // Map the strict wire plan (string-encoded tool inputs) back to the runtime
  // ExecutionPlan and re-validate against the canonical schema — the single
  // contract every downstream consumer (executor, inspector, timeline) relies on.
  return executionPlanSchema.parse(executionPlanFromWire(wirePlan))
}
