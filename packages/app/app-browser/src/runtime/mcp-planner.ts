import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'
import type { ConversationMessage } from '@tinytinkerer/app-core'
import { executionPlanSchema, type ExecutionPlan } from '@tinytinkerer/contracts'
import type { EdgeFetch } from './edge-fetch'

export type PlannerToolDescriptor = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
}

const buildPlanningSystemPrompt = (tools: PlannerToolDescriptor[]): string => {
  const toolDocs = tools
    .map(
      (t) =>
        `Tool: ${t.id}\nDescription: ${t.description}\nInput schema: ${JSON.stringify(t.inputSchema, null, 2)}`
    )
    .join('\n\n')

  return `You are a planning assistant. Given a user prompt and conversation history, produce an execution plan as JSON.

Available tools:
${toolDocs}

Return ONLY a JSON object matching this schema (no markdown, no explanation):
{
  "complexity": "low" | "medium" | "high",
  "steps": [
    {
      "id": "<unique_step_id>",
      "summary": "<what this step does>",
      "toolCall": { "toolId": "<tool_id>", "input": { ...args } }  // optional
    }
  ]
}

Rules:
- Always include an "understand" step first and a "compose" step last.
- Only include toolCall when the tool is genuinely needed to answer the question.
- Use exact tool IDs from the list above.
- Arguments must match the tool's input schema.`
}

export const llmPlan = async (
  prompt: string,
  history: ConversationMessage[],
  tools: PlannerToolDescriptor[],
  model: string,
  edgeFetch: EdgeFetch,
  signal?: AbortSignal
): Promise<ExecutionPlan> => {
  const systemPrompt = buildPlanningSystemPrompt(tools)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt }
  ]

  const response = await edgeFetch(
    '/api/models/chat',
    { model, stream: false, messages },
    {
      area: 'planning.chat',
      stream: false,
      ...(signal ? { signal } : {})
    }
  )

  if (!response.ok) {
    throw new Error(`Planning request failed (${response.status})`)
  }

  const metadata = {
    area: 'planning.chat' as const,
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
    'Planning response body was not valid JSON',
    () => JSON.parse(jsonText) as unknown,
    response
  )
  return parseWithTelemetry(
    metadata,
    'schema_error',
    'Planning response did not match execution plan schema',
    () => executionPlanSchema.parse(parsedJson),
    response
  )
}
