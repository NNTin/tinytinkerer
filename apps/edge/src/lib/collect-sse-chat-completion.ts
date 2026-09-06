// Reassembles an SSE `chat/completions` stream into the single-response JSON
// shape a non-streaming caller expects. LiteLLM's `chatgpt/*` (ChatGPT-
// subscription/Codex) provider has a bug where its own non-streaming path
// returns an empty `output` array even when the model generated text — a
// `stream=false` request to LiteLLM fails every time for these models, while
// streaming is unaffected. The edge works around this by always requesting
// `stream: true` from LiteLLM and, when the CLIENT asked for a non-streaming
// response, collecting the SSE chunks here instead of piping them through —
// so the bug is invisible outside this file. Mirrors the equivalent
// `_collect_stream` in pixel-agents-cogs' `corridor/infrastructure/llm_client.py`,
// which hit the same LiteLLM behaviour from a different codebase.

type CollectedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type CollectedChoice = {
  message: {
    role: string
    content: string | null
    tool_calls?: CollectedToolCall[]
  }
  // Absent (not null) when no chunk carried a finish_reason — ModelsChatChoice's
  // finish_reason is `z.string().optional()`, which rejects `null`.
  finish_reason?: string
}

export type CollectedChatCompletion = {
  choices: CollectedChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

type StreamDeltaToolCall = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type StreamChunk = {
  choices?: Array<{
    index?: number
    delta?: {
      role?: string
      content?: string
      tool_calls?: StreamDeltaToolCall[]
    }
    finish_reason?: string | null
  }>
  usage?: CollectedChatCompletion['usage']
}

// Reads every `data: {...}` line out of a raw SSE body, ignoring the
// terminal `data: [DONE]` marker and any non-JSON/keepalive line.
const parseSseChunks = (rawText: string): StreamChunk[] => {
  const chunks: StreamChunk[] = []
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice('data:'.length).trim()
    if (!data || data === '[DONE]') continue
    try {
      chunks.push(JSON.parse(data) as StreamChunk)
    } catch {
      // A malformed/truncated line is dropped rather than failing the whole
      // reassembly — the caller still validates the final shape.
      continue
    }
  }
  return chunks
}

export const collectSseChatCompletion = (rawText: string): CollectedChatCompletion => {
  const chunks = parseSseChunks(rawText)
  const choicesByIndex = new Map<number, CollectedChoice>()
  let usage: CollectedChatCompletion['usage']

  for (const chunk of chunks) {
    if (chunk.usage) usage = chunk.usage
    for (const choice of chunk.choices ?? []) {
      const index = choice.index ?? 0
      const entry = choicesByIndex.get(index) ?? {
        message: { role: 'assistant', content: null }
      }
      choicesByIndex.set(index, entry)

      const delta = choice.delta ?? {}
      if (delta.role) entry.message.role = delta.role
      if (delta.content) entry.message.content = (entry.message.content ?? '') + delta.content
      if (delta.tool_calls) {
        const toolCalls = entry.message.tool_calls ?? []
        entry.message.tool_calls = toolCalls
        for (const toolCallDelta of delta.tool_calls) {
          const toolCallIndex = toolCallDelta.index ?? 0
          while (toolCalls.length <= toolCallIndex) {
            toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } })
          }
          const toolCall = toolCalls[toolCallIndex]
          if (!toolCall) continue
          if (toolCallDelta.id) toolCall.id = toolCallDelta.id
          if (toolCallDelta.function?.name) toolCall.function.name += toolCallDelta.function.name
          if (toolCallDelta.function?.arguments) {
            toolCall.function.arguments += toolCallDelta.function.arguments
          }
        }
      }
      if (choice.finish_reason) entry.finish_reason = choice.finish_reason
    }
  }

  const choices = [...choicesByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, choice]) => choice)

  return { choices, ...(usage ? { usage } : {}) }
}
