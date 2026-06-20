import { describe, expect, it } from 'vitest'
import type { SynthesisChunk } from '@tinytinkerer/app-core'
import { extractUsageChunk, parseSseStream, splitInlineThink } from '../src/runtime/sse-utils.js'

// Build a ReadableStream from raw SSE text the way LiteLLM frames it.
const sseBody = (text: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

const drain = async (stream: AsyncIterable<SynthesisChunk>): Promise<SynthesisChunk[]> => {
  const chunks: SynthesisChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('extractUsageChunk', () => {
  it('reads prompt/completion/total tokens from a usage block', () => {
    expect(
      extractUsageChunk({ choices: [], usage: { prompt_tokens: 800, completion_tokens: 20, total_tokens: 820 } })
    ).toEqual({ kind: 'usage', promptTokens: 800, completionTokens: 20, totalTokens: 820 })
  })

  it('returns undefined when usage is absent or has no numeric prompt_tokens', () => {
    expect(extractUsageChunk({ choices: [] })).toBeUndefined()
    expect(extractUsageChunk({ usage: {} })).toBeUndefined()
    expect(extractUsageChunk({ usage: { prompt_tokens: 'nope' } })).toBeUndefined()
  })
})

describe('parseSseStream usage handling', () => {
  it('emits content deltas followed by a terminal usage chunk', async () => {
    const body = sseBody(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}`,
        '',
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1234 } })}`,
        '',
        'data: [DONE]',
        ''
      ].join('\n')
    )

    const chunks = await drain(parseSseStream(body, undefined))
    expect(chunks).toContainEqual({ kind: 'content', text: 'hi' })
    expect(chunks).toContainEqual({ kind: 'usage', promptTokens: 1234 })
  })

  it('passes usage chunks through splitInlineThink untouched', async () => {
    const body = sseBody(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}`,
        '',
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42 } })}`,
        '',
        'data: [DONE]',
        ''
      ].join('\n')
    )

    const chunks = await drain(splitInlineThink(parseSseStream(body, undefined)))
    expect(chunks.filter((chunk) => chunk.kind === 'usage')).toEqual([
      { kind: 'usage', promptTokens: 42 }
    ])
  })
})
