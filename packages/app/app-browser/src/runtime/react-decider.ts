import { parseJsonWithTelemetry } from '../telemetry/request-telemetry'
import type { DecisionChunk, ExecutionContext, ToolCallChunk } from '@tinytinkerer/app-core'
import type { ChatMessage, ChatToolCall, ReActDecision } from '@tinytinkerer/contracts'
import { createEdgeError, type ModelsChatFetch } from './edge-fetch'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createRateLimitError } from './rate-limit'
import { parseSseStream, splitInlineThink } from './sse-utils'
import {
  buildToolNameMap,
  parseToolCallArguments,
  toolInvocationsToMessages,
  type ToolNameMap
} from './tool-calling'

// Native tool calling (issue #276): the decider advertises the available tools
// and lets the model answer with native `tool_calls` (take an action) or plain
// content (it is ready to finish). The tool catalogue is no longer described in
// the system prompt and the model no longer emits a hand-rolled JSON decision —
// that brittle prose protocol (and its truncation-recovery parsing) is retired.
const buildDecisionSystemPrompt = (): string =>
  `You are a ReAct agent. You solve the user's request by reasoning and acting one step at a time.
Given the user's request and the tool results gathered so far, either call the SINGLE most useful tool to make progress, or — once you have enough information — answer directly without calling any tool.

Rules:
- Think through your decision step by step first; your thinking is shown to the user as it streams.
- Call a tool only when one is genuinely needed to make progress.
- Call at most one tool per step.
- When the gathered tool results are sufficient, stop calling tools and respond with a short confirmation; the final answer is composed separately.`

// Assemble the request messages shared by both decision variants. The accumulated
// tool I/O is replayed as native assistant `tool_calls` + `tool` result turns
// (issue #276) — identical in shape to the synthesis path — instead of prose
// notes glued onto the user message.
const buildMessages = (context: ExecutionContext, names: ToolNameMap): ChatMessage[] => [
  { role: 'system', content: buildDecisionSystemPrompt() },
  ...context.history.map((message) => ({ role: message.role, content: message.content })),
  { role: 'user' as const, content: context.prompt },
  ...toolInvocationsToMessages(context.toolInvocations, names.toWire)
]

type DecisionRequestMetadata = {
  area: 'react.decide'
  origin: 'edge'
  method: string
  url: string
  model: string
  stream: boolean
}

// Shared request shape for both decision variants: advertise the tools, send the
// system + history + native tool-call messages, POST to /api/models/chat, and map
// the two non-success outcomes the runtime cares about — a 429 (surfaced as a
// RateLimitError so the cooldown/retry path handles it) and any other non-ok
// status (a generic edge error). The only difference between callers is `stream`.
const requestDecision = async (
  context: ExecutionContext,
  names: ToolNameMap,
  model: string,
  modelsChat: ModelsChatFetch,
  stream: boolean,
  signal?: AbortSignal
): Promise<Response> => {
  const response = await modelsChat(
    {
      model,
      stream,
      messages: buildMessages(context, names),
      tools: names.definitions,
      // `auto`: the model decides whether to call a tool or answer. Synthesis
      // uses `none` to force a final answer (see litellm-provider).
      tool_choice: 'auto'
    },
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

// Turn a chosen native tool call into a ReActDecision. The model addresses tools
// by their advertised (wire-safe) function name, so map it back to the real tool
// id; the arguments arrive as a JSON string, parsed into the action input. A tool
// call whose arguments are not valid JSON is treated as empty input rather than
// crashing the run — the tool's own schema validation is the real gate. Any prose
// the model emitted alongside the call (its "why") is carried as `reasoning` —
// genuine model prose only, omitted when the model is silent (the common native
// tool-calling case). The timeline shows the model's prose as the step's thought
// and renders just the decision badge when there is none (issue #276).
const toActionDecision = (
  toolCall: ChatToolCall,
  names: ToolNameMap,
  reasoning?: string
): ReActDecision => ({
  kind: 'action',
  toolId: names.toToolId(toolCall.function.name),
  input: parseToolCallArguments(toolCall.function.arguments),
  ...(reasoning && reasoning.trim().length > 0 ? { reasoning } : {})
})

// Accumulator for streamed native tool-call fragments (issue #276). OpenAI streams
// each call's `id`/`name` once and its `arguments` across several deltas keyed by
// `index`; collect them in arrival order so the first complete call drives the
// action decision (the runtime executes one tool per step).
type ToolCallAccumulator = { id: string; name: string; arguments: string }

const applyToolCallChunk = (
  accumulators: Map<number, ToolCallAccumulator>,
  chunk: ToolCallChunk
): void => {
  const existing = accumulators.get(chunk.index) ?? { id: '', name: '', arguments: '' }
  accumulators.set(chunk.index, {
    id: chunk.id ?? existing.id,
    name: chunk.name ?? existing.name,
    arguments: existing.arguments + (chunk.argumentsDelta ?? '')
  })
}

const accumulatorToToolCall = (accumulator: ToolCallAccumulator): ChatToolCall => ({
  id: accumulator.id,
  type: 'function',
  function: { name: accumulator.name, arguments: accumulator.arguments }
})

// Asks the model for the next ReAct decision (call a tool, or finish) given the
// tool results accumulated in `context`. Non-streaming variant: reads the chosen
// tool call from `choices[0].message.tool_calls`; absent tool calls means the
// model answered with content, i.e. it is ready to finish.
export const decideNextAction = async (
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  signal?: AbortSignal
): Promise<ReActDecision> => {
  const names = buildToolNameMap(tools)
  const response = await requestDecision(context, names, model, modelsChat, false, signal)

  const metadata = decisionMetadata(response, model, false)
  const data = await parseJsonWithTelemetry<{
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>
  }>(metadata, response)
  const message = data.choices?.[0]?.message
  // A non-reasoning model expresses its rationale as ordinary `content` (not a
  // separate reasoning channel); carry it as the decision's reasoning so the
  // timeline shows the model's "why" for the step (issue #276).
  const reasoning = typeof message?.content === 'string' ? message.content : undefined
  const toolCall = message?.tool_calls?.[0]

  return toolCall
    ? toActionDecision(toolCall, names, reasoning)
    : { kind: 'final', ...(reasoning && reasoning.trim().length > 0 ? { reasoning } : {}) }
}

// Streaming variant of decideNextAction. Requests a streamed completion and
// splits it into the model's reasoning (yielded as growing `thought` chunks so
// the UI can render the step live) and the native tool-call fragments (assembled
// across deltas). At end-of-stream the first complete tool call becomes the
// action decision; if the model emitted no tool call it is ready to finish.
export async function* streamDecision(
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  modelsChat: ModelsChatFetch,
  signal?: AbortSignal
): AsyncGenerator<DecisionChunk> {
  const names = buildToolNameMap(tools)
  const response = await requestDecision(context, names, model, modelsChat, true, signal)

  let thought = ''
  const toolCalls = new Map<number, ToolCallAccumulator>()

  if (!response.body) {
    throw new Error('ReAct decision stream missing response body')
  }

  for await (const chunk of splitInlineThink(parseSseStream(response.body, signal))) {
    // Both the reasoning channel (reasoning models) AND ordinary `content` (a
    // non-reasoning model's prose preamble before/instead of a tool call) are the
    // model's visible thinking, so stream both as the growing thought — otherwise
    // the timeline shows no rationale for models that don't emit reasoning_content
    // (issue #276). The terminal `usage` chunk carries no decision signal.
    if (chunk.kind === 'reasoning' || chunk.kind === 'content') {
      thought += chunk.text
      yield { kind: 'thought', text: thought }
    } else if (chunk.kind === 'tool_call') {
      applyToolCallChunk(toolCalls, chunk)
    }
  }

  const firstCall = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value)
    .find((value) => value.name.length > 0)

  // Carry the streamed prose as the decision's reasoning, mirroring the
  // non-streaming path so the two cannot diverge (issue #276). For an action with
  // no prose, toActionDecision derives a label from the call; a final with no
  // prose simply has no reasoning (the synthesized answer follows it).
  const reasoning = thought.trim().length > 0 ? thought : undefined
  const decision: ReActDecision = firstCall
    ? toActionDecision(accumulatorToToolCall(firstCall), names, reasoning)
    : { kind: 'final', ...(reasoning ? { reasoning } : {}) }
  yield { kind: 'decision', decision }
}
