import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'
import type { DecisionChunk, ExecutionContext } from '@tinytinkerer/app-core'
import { reactDecisionSchema, type ReActDecision } from '@tinytinkerer/contracts'
import type { EdgeFetch } from './edge-fetch'
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
    context.notes.filter(Boolean).length > 0 && `\nObservations so far:\n${context.notes.join('\n')}`,
    toolSection && `\nTool results:\n${toolSection}`
  ]
    .filter(Boolean)
    .join('')
}

// Asks the model for the next ReAct decision (one action, or finish) given the
// observations accumulated in `context`. Mirrors the planner's edge call shape:
// a non-streaming /api/models/chat request whose JSON body is validated against
// `reactDecisionSchema`.
export const decideNextAction = async (
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  edgeFetch: EdgeFetch,
  signal?: AbortSignal
): Promise<ReActDecision> => {
  const systemPrompt = buildDecisionSystemPrompt(tools)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...context.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: buildObservations(context) }
  ]

  const response = await edgeFetch(
    '/api/models/chat',
    { model, stream: false, messages },
    {
      area: 'react.decide',
      stream: false,
      ...(signal ? { signal } : {})
    }
  )

  // A 429 must go through the runtime's cooldown/retry path, so surface it as a
  // RateLimitError rather than a generic failure that ends the run.
  if (response.status === 429) {
    throw await createRateLimitError(response)
  }

  if (!response.ok) {
    throw new Error(`ReAct decision request failed (${response.status})`)
  }

  const metadata = {
    area: 'react.decide' as const,
    origin: 'edge' as const,
    method: 'POST',
    url: response.url,
    stream: false
  }
  const data = await parseJsonWithTelemetry<{
    choices?: Array<{ message?: { content?: string | null } }>
  }>(metadata, response)
  const text = data.choices?.[0]?.message?.content ?? ''

  const jsonText = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsedJson = parseWithTelemetry<unknown>(
    metadata,
    'parse_error',
    'ReAct decision body was not valid JSON',
    () => JSON.parse(jsonText) as unknown,
    response
  )
  return parseWithTelemetry(
    metadata,
    'schema_error',
    'ReAct decision did not match the decision schema',
    () => reactDecisionSchema.parse(parsedJson),
    response
  )
}

const stripFences = (text: string): string =>
  text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

// Streaming variant of decideNextAction. Requests a streamed completion and
// splits it into the model's reasoning (yielded as growing `thought` chunks so
// the UI can render the step live) and the answer content (accumulated and
// parsed as the structured decision once the stream ends).
export async function* streamDecision(
  context: ExecutionContext,
  tools: PlannerToolDescriptor[],
  model: string,
  edgeFetch: EdgeFetch,
  signal?: AbortSignal
): AsyncGenerator<DecisionChunk> {
  const systemPrompt = buildDecisionSystemPrompt(tools)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...context.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: buildObservations(context) }
  ]

  const response = await edgeFetch(
    '/api/models/chat',
    { model, stream: true, messages },
    {
      area: 'react.decide',
      stream: true,
      ...(signal ? { signal } : {})
    }
  )

  // A 429 must go through the runtime's cooldown/retry path, so surface it as a
  // RateLimitError rather than a generic failure that ends the run.
  if (response.status === 429) {
    throw await createRateLimitError(response)
  }

  if (!response.ok) {
    throw new Error(`ReAct decision request failed (${response.status})`)
  }

  let thought = ''
  let jsonBuffer = ''

  if (response.body) {
    for await (const chunk of splitInlineThink(parseSseStream(response.body, signal))) {
      if (chunk.kind === 'reasoning') {
        thought += chunk.text
        yield { kind: 'thought', text: thought }
      } else {
        jsonBuffer += chunk.text
      }
    }
  }

  const decision = reactDecisionSchema.parse(JSON.parse(stripFences(jsonBuffer)))
  yield { kind: 'decision', decision }
}
