import type { ChatEvent } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ModelProvider, SynthesisChunk } from '../src/types'

// The host's last-chance answer rewrite (issue #478). agent-core owns *when* it
// runs and what happens if it misbehaves; what it rewrites an answer into is the
// host's business and is tested there.

// Answers immediately with `final`, so every run reaches synthesis without a
// tool step; `plan`/`execute` exist only to satisfy the interface.
const provider = (chunks: string[]): ModelProvider => ({
  plan: () => Promise.resolve({ complexity: 'low', steps: [] }),
  execute: () => Promise.resolve(''),
  decideNextAction: () => Promise.resolve({ kind: 'final' }),
  // eslint-disable-next-line @typescript-eslint/require-await
  async *synthesize(): AsyncGenerator<SynthesisChunk> {
    for (const text of chunks) {
      yield { kind: 'content', text }
    }
  }
})

const drain = async (runtime: ReActRuntime): Promise<ChatEvent[]> => {
  const events: ChatEvent[] = []
  for await (const event of runtime.run('a question')) {
    events.push(event)
  }
  return events
}

const doneSource = (events: ChatEvent[]): string => {
  // Not `findLast`: this package targets a lib that predates it.
  const done = [...events].reverse().find((event) => event.type === 'assistant.done')
  if (!done) throw new Error('no assistant.done event')
  return (done.payload as { source: string }).source
}

describe('finalizeAssistantContent', () => {
  it('replaces the answer that assistant.done carries', async () => {
    const events = await drain(
      new ReActRuntime(provider(['half ', 'an answer']), new ToolRegistry(), {
        finalizeAssistantContent: ({ source }) => Promise.resolve(`${source}\n\nfooter`)
      })
    )

    expect(doneSource(events)).toBe('half an answer\n\nfooter')
    // The streamed chunks are untouched; only the terminal snapshot is rewritten
    // — which is the one the projection persists.
    const chunks = events.filter((event) => event.type === 'assistant.chunk')
    expect(chunks.at(-1)?.payload).toMatchObject({ source: 'half an answer' })
  })

  it("sees the run's ordered tool invocations, successes and failures alike", async () => {
    const seen = vi.fn()
    const registry = new ToolRegistry()
    await drain(
      new ReActRuntime(provider(['answer']), registry, {
        finalizeAssistantContent: ({ context, source, snapshot }) => {
          seen({ toolInvocations: context.toolInvocations, source, snapshot })
          return Promise.resolve(source)
        }
      })
    )

    expect(seen).toHaveBeenCalledTimes(1)
    const call = seen.mock.calls[0]?.[0] as { source: string; snapshot: { source: string } }
    expect(call.source).toBe('answer')
    expect(call.snapshot.source).toBe('answer')
  })

  it("keeps the model's answer when the finalizer throws, and reports it", async () => {
    const reportError = vi.fn()
    const events = await drain(
      new ReActRuntime(provider(['the answer']), new ToolRegistry(), {
        reportError,
        finalizeAssistantContent: () => Promise.reject(new Error('policy blew up'))
      })
    )

    expect(doneSource(events)).toBe('the answer')
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'policy blew up' }))
    // A failed footer is not a failed run.
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it('leaves the answer untouched for a host that registers none', async () => {
    const events = await drain(new ReActRuntime(provider(['plain']), new ToolRegistry()))
    expect(doneSource(events)).toBe('plain')
  })
})
