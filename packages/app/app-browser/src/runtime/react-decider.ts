import { parseJsonWithTelemetry, parseModelJsonWithTelemetry } from '../telemetry/request-telemetry'
import type { DecisionChunk, ExecutionContext } from '@tinytinkerer/app-core'
import { reactDecisionSchema, type ReActDecision } from '@tinytinkerer/contracts'
import { createEdgeError, type ModelsChatFetch } from './edge-fetch'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createRateLimitError } from './rate-limit'
import { parseSseStream, splitInlineThink } from './sse-utils'

const buildDecisionSystemPrompt = (tools: PlannerToolDescriptor[]): string => {
  const toolDocs = tools
    .map(
      (t) =>
        `Tool: ${t.id}\nDescription: ${t.description}\nInput schema: ${JSON.stringify(t.inputSchema, null, 2)}`
    )
    .join('\n\n')

  return `You are a ReAct agent. You solve the user's request by reasoning and acting one step at a time.
Given the user's request and the observations gathered so far, decide the SINGLE next action to take, or decide that you now have enough information to answer.

Available tools:
${toolDocs}

Return ONLY a JSON object (no markdown, no explanation) matching one of these shapes:
- To take an action: { "kind": "action", "reasoning": "<why this action>", "toolId": "<tool_id>", "input": { ...args } }
- To finish: { "kind": "final", "reasoning": "<why you can answer now>" }

Rules:
- Think through your decision step by step first; your thinking is shown to the user as it streams.
- After thinking, your final message must be ONLY the JSON object — no markdown, no commentary.
- Choose "action" only when a tool is genuinely needed to make progress.
- Choose "final" as soon as the gathered observations are sufficient to answer.
- Use exact tool IDs from the list above; arguments must match the tool's input schema.`
}

const buildObservations = (context: ExecutionContext): string => {
  const toolSection = Object.entries(context.toolResults)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')

  return [
    `Request: ${context.prompt}`,
    context.notes.filter(Boolean).length > 0 &&
      `\nObservations so far:\n${context.notes.join('\n')}`,
    toolSection && `\nTool results:\n${toolSection}`
  ]
    .filter(Boolean)
    .join('')
}

type DecisionRequestMetadata = {
  area: 'react.decide'
  origin: 'edge'
  method: string
  url: string
  model: string
  stream: boolean
}

// Shared request shape for both decision variants: build the system prompt +
// history + observations message list, POST it to /api/models/chat, and map the
// two non-success outcomes the runtime cares about — a 429 (surfaced as a
// RateLimitError so the cooldown/retry path handles it, not a generic run-ending
// failure) and any other non-ok status (a generic edge error). The only
// difference between the two callers is `stream` and what they do with the
// returned response body.
const requestDecision = async (
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  stream: boolean,
  signal?: AbortSignal
): Promise<Response> => {
  const messages = [
    { role: 'system' as const, content: buildDecisionSystemPrompt(tools) },
    ...context.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: buildObservations(context) }
  ]

  const response = await modelsChat(
    { model, stream, messages },
    {
      area: 'react.decide',
      ...(signal ? { signal } : {})
    }
  )

  // A 429 must go through the runtime's cooldown/retry path, so surface it as a
  // RateLimitError rather than a generic failure that ends the run.
  if (response.status === 429) {
    throw await createRateLimitError(response)
  }

  if (!response.ok) {
    throw await createEdgeError(response, `ReAct decision request failed (${response.status})`)
  }

  return response
}

const decisionMetadata = (
  response: Response,
  model: string,
  stream: boolean
): DecisionRequestMetadata => ({
  area: 'react.decide',
  origin: 'edge',
  method: 'POST',
  url: response.url,
  model,
  stream
})

// Turn the model's answer text into a ReActDecision, recovering from the model's
// inherent non-compliance without ever crashing the run. A streaming model will
// sometimes emit prose ("I now have enough information…"), an empty answer, or
// truncated/malformed JSON when the stream is cut short. We must not let that
// crash the whole run: the parse error otherwise propagates through nextDecision
// (which only retries rate limits) and kills the run, so an unusable decision
// falls back to `final` and the loop synthesizes an answer — mirroring the
// runtime's existing `decision ?? { kind: 'final' }` fallback.
//
// Distinguish two flavours of "no decision JSON" (they are NOT the same defect):
//   - PURE PROSE (no `{`/`[` at all) — the model simply *finished in prose*. That
//     is the correct, expected `final` outcome, not a bug, so we pass
//     `silentWhenNoJson` to recover WITHOUT capturing telemetry (it was generating
//     recurring noise that auto-regressed TINYTINKERER-FRONTEND-K every time the
//     model answered in prose).
//   - TRUNCATED / MALFORMED JSON or a WRONG SHAPE — a JSON value was present but
//     cut off mid-action or did not validate. That means we ABANDONED the tool
//     action the model was emitting and answered from incomplete results — a real
//     defect. We do NOT `accept`/suppress it: it is still captured (stays loud) so
//     we can investigate why the stream truncates / the model misconforms.
// We recover for the user in both cases, but only stay loud for the lossy one.
// (TINYTINKERER-FRONTEND-J / -K.)
const parseDecisionOrFinal = (
  metadata: DecisionRequestMetadata,
  jsonText: string,
  response: Response
): ReActDecision => {
  try {
    // The shared helper strips ```json fences, parses robustly (tolerating
    // sloppy-but-complete output, never repairing a truncated value), and
    // validates the schema. With `silentWhenNoJson` a pure-prose finish is a
    // benign no_json (not captured); truncation/schema failures stay loud.
    return parseModelJsonWithTelemetry(
      metadata,
      jsonText,
      reactDecisionSchema,
      {
        parseError: 'ReAct decision body was not valid JSON',
        schemaError: 'ReAct decision did not match the decision schema'
      },
      response,
      { silentWhenNoJson: true }
    )
  } catch {
    return { kind: 'final' }
  }
}

// Asks the model for the next ReAct decision (one action, or finish) given the
// observations accumulated in `context`. Mirrors the planner's edge call shape:
// a non-streaming /api/models/chat request whose JSON body is validated against
// `reactDecisionSchema`.
export const decideNextAction = async (
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  signal?: AbortSignal
): Promise<ReActDecision> => {
  const response = await requestDecision(context, tools, model, modelsChat, false, signal)

  const metadata = decisionMetadata(response, model, false)
  const data = await parseJsonWithTelemetry<{
    choices?: Array<{ message?: { content?: string | null } }>
  }>(metadata, response)
  const text = data.choices?.[0]?.message?.content ?? ''

  return parseDecisionOrFinal(metadata, text, response)
}

// Streaming variant of decideNextAction. Requests a streamed completion and
// splits it into the model's reasoning (yielded as growing `thought` chunks so
// the UI can render the step live) and the answer content (accumulated and
// parsed as the structured decision once the stream ends).
export async function* streamDecision(
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  signal?: AbortSignal
): AsyncGenerator<DecisionChunk> {
  const response = await requestDecision(context, tools, model, modelsChat, true, signal)

  let thought = ''
  let jsonBuffer = ''

  if (!response.body) {
    throw new Error('ReAct decision stream missing response body')
  }

  for await (const chunk of splitInlineThink(parseSseStream(response.body, signal))) {
    if (chunk.kind === 'reasoning') {
      thought += chunk.text
      yield { kind: 'thought', text: thought }
    } else if (chunk.kind === 'content') {
      jsonBuffer += chunk.text
    }
    // A terminal `usage` chunk carries no text; the decision path ignores it
    // (usage is surfaced from the synthesize stream).
  }

  const metadata = decisionMetadata(response, model, true)
  const decision = parseDecisionOrFinal(metadata, jsonBuffer, response)
  yield { kind: 'decision', decision }
}
