import type { SynthesisChunk } from '@tinytinkerer/app-core'

// Shared Server-Sent-Events / inline-think parsing used by both the chat
// synthesizer (github-models-provider) and the ReAct decision streamer
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

// Some reasoning models (e.g. DeepSeek-R1 via GitHub Models) stream their
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
    if (chunk.kind === 'reasoning') {
      yield chunk
      continue
    }
    buffer += chunk.text
    yield* drain(false)
  }
  yield* drain(true)
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

  try {
    while (true) {
      if (signal?.aborted) {
        return
      }

      const { done, value } = await reader.read()
      if (done) {
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue
        }

        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          return
        }

        try {
          const json = JSON.parse(data) as Record<string, unknown>
          const choices = json['choices']
          if (!Array.isArray(choices)) {
            continue
          }

          const delta = (choices[0] as Record<string, unknown> | undefined)?.['delta']
          const reasoning = extractReasoning(delta)
          if (reasoning) {
            yield { kind: 'reasoning', text: reasoning }
          }
          const content = (delta as Record<string, unknown> | undefined)?.['content']
          if (typeof content === 'string' && content) {
            yield { kind: 'content', text: content }
          }
        } catch {
          // Skip malformed SSE lines.
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
