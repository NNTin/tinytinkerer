import type { SynthesisChunk, ToolCallChunk } from '@tinytinkerer/app-core'

// Shared Server-Sent-Events / inline-think parsing used by both the chat
// synthesizer (litellm-provider) and the ReAct decision streamer
// (react-decider). Kept in its own module so neither imports the other, which
// would create a circular module dependency.

// Surfaces the model's raw chain-of-thought when present. Different OpenAI-compatible
// gateways expose it under different keys (DeepSeek-R1 uses `reasoning_content`, some
// others use `reasoning`); absence is normal and yields nothing.
export const extractReasoning = (delta: unknown): string | undefined => {
  if (!delta || typeof delta !== 'object') {
    return undefined
  }

  const record = delta as Record<string, unknown>
  const reasoningContent = record['reasoning_content']
  if (typeof reasoningContent === 'string' && reasoningContent) {
    return reasoningContent
  }

  const reasoning = record['reasoning']
  if (typeof reasoning === 'string' && reasoning) {
    return reasoning
  }

  return undefined
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

// Longest suffix of `text` that is a proper prefix of `tag` — i.e. the part we
// must hold back because it could be the start of `tag` continued in the next
// chunk.
const partialTagSuffixLength = (text: string, tag: string): number => {
  const max = Math.min(text.length, tag.length - 1)
  for (let len = max; len > 0; len -= 1) {
    if (tag.startsWith(text.slice(text.length - len))) {
      return len
    }
  }
  return 0
}

// Some reasoning models (e.g. DeepSeek-R1 via LiteLLM) stream their
// chain-of-thought inline in the content wrapped in <think>…</think> rather than
// in a separate reasoning_content delta. Re-route those regions to the reasoning
// channel so they render in the activity panel instead of the final answer.
// Tags may straddle chunk boundaries, so a partial-tag suffix is buffered.
// Chunks already classified as reasoning pass through untouched.
export async function* splitInlineThink(
  stream: AsyncIterable<SynthesisChunk>
): AsyncGenerator<SynthesisChunk> {
  let insideThink = false
  let buffer = ''

  function* drain(flush: boolean): Generator<SynthesisChunk> {
    for (;;) {
      const tag = insideThink ? THINK_CLOSE : THINK_OPEN
      const index = buffer.indexOf(tag)
      if (index !== -1) {
        const segment = buffer.slice(0, index)
        if (segment) {
          yield { kind: insideThink ? 'reasoning' : 'content', text: segment }
        }
        buffer = buffer.slice(index + tag.length)
        insideThink = !insideThink
        continue
      }

      const hold = flush ? 0 : partialTagSuffixLength(buffer, tag)
      const emit = buffer.slice(0, buffer.length - hold)
      if (emit) {
        yield { kind: insideThink ? 'reasoning' : 'content', text: emit }
      }
      buffer = buffer.slice(buffer.length - hold)
      break
    }
  }

  for await (const chunk of stream) {
    // Only `content` is re-segmented for inline <think> tags; everything else
    // (reasoning, the terminal usage chunk) passes through untouched.
    if (chunk.kind !== 'content') {
      yield chunk
      continue
    }
    buffer += chunk.text
    yield* drain(false)
  }
  yield* drain(true)
}

// Extract the OpenAI-compatible `usage` block LiteLLM appends as a final SSE
// chunk when `stream_options.include_usage` is set. That chunk carries an empty
// `choices` array and a top-level `usage`, so it is parsed independently of the
// content deltas. Absent/malformed usage yields nothing.
export const extractUsageChunk = (json: Record<string, unknown>): SynthesisChunk | undefined => {
  const usage = json['usage']
  if (!usage || typeof usage !== 'object') {
    return undefined
  }
  const record = usage as Record<string, unknown>
  const promptTokens = record['prompt_tokens']
  if (typeof promptTokens !== 'number' || !Number.isFinite(promptTokens)) {
    return undefined
  }
  const completionTokens = record['completion_tokens']
  const totalTokens = record['total_tokens']
  return {
    kind: 'usage',
    promptTokens,
    ...(typeof completionTokens === 'number' ? { completionTokens } : {}),
    ...(typeof totalTokens === 'number' ? { totalTokens } : {})
  }
}

// Pull native tool-call deltas off a streamed `choices[0].delta` (issue #276).
// OpenAI streams each tool call as `{ index, id?, type?, function: { name?,
// arguments? } }`, with `id`/`name` present on the first fragment and
// `arguments` accumulating across fragments. Anything missing/malformed yields
// nothing, mirroring the tolerant content/reasoning extraction above.
const extractToolCallChunks = (delta: unknown): ToolCallChunk[] => {
  if (!delta || typeof delta !== 'object') {
    return []
  }
  const toolCalls = (delta as Record<string, unknown>)['tool_calls']
  if (!Array.isArray(toolCalls)) {
    return []
  }
  const chunks: ToolCallChunk[] = []
  for (const entry of toolCalls) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    const index = record['index']
    if (typeof index !== 'number') {
      continue
    }
    const fn = record['function'] as Record<string, unknown> | undefined
    const rawId = record['id']
    const id = typeof rawId === 'string' ? rawId : undefined
    const rawName = fn?.['name']
    const name = typeof rawName === 'string' ? rawName : undefined
    const rawArguments = fn?.['arguments']
    const argumentsDelta = typeof rawArguments === 'string' ? rawArguments : undefined
    chunks.push({
      kind: 'tool_call',
      index,
      ...(id !== undefined ? { id } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(argumentsDelta !== undefined ? { argumentsDelta } : {})
    })
  }
  return chunks
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined
): AsyncGenerator<SynthesisChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const onAbort = () => {
    reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const parseSseLine = (line: string): { chunks: SynthesisChunk[]; done: boolean } => {
    if (!line.startsWith('data: ')) {
      return { chunks: [], done: false }
    }

    const data = line.slice(6).trim()
    if (data === '[DONE]') {
      return { chunks: [], done: true }
    }

    try {
      const json = JSON.parse(data) as Record<string, unknown>
      const chunks: SynthesisChunk[] = []

      // The terminal usage chunk (include_usage) carries an empty `choices`
      // array, so check usage before bailing on a missing/empty choices list.
      const usageChunk = extractUsageChunk(json)
      if (usageChunk) {
        chunks.push(usageChunk)
      }

      const choices = json['choices']
      if (!Array.isArray(choices)) {
        return { chunks, done: false }
      }

      const delta = (choices[0] as Record<string, unknown> | undefined)?.['delta']
      const reasoning = extractReasoning(delta)
      if (reasoning) {
        chunks.push({ kind: 'reasoning', text: reasoning })
      }
      const content = (delta as Record<string, unknown> | undefined)?.['content']
      if (typeof content === 'string' && content) {
        chunks.push({ kind: 'content', text: content })
      }
      // Native tool calling (issue #276): the model streams its chosen tool calls
      // as `delta.tool_calls` fragments keyed by `index` — `id`/`name` arrive
      // once, `arguments` across several deltas. Surface each fragment as a
      // `tool_call` chunk; the decide path accumulates them by index.
      for (const toolCallChunk of extractToolCallChunks(delta)) {
        chunks.push(toolCallChunk)
      }
      return { chunks, done: false }
    } catch {
      // Skip malformed SSE lines.
      return { chunks: [], done: false }
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        return
      }

      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        for (const line of buffer.split('\n')) {
          const parsed = parseSseLine(line)
          for (const chunk of parsed.chunks) {
            yield chunk
          }
          if (parsed.done) {
            return
          }
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const parsed = parseSseLine(line)
        for (const chunk of parsed.chunks) {
          yield chunk
        }
        if (parsed.done) {
          return
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
