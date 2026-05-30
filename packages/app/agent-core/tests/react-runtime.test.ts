import type { ChatEvent, ReActDecision } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RateLimitError } from '../src/errors/rate-limit-error'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ExecutionContext, ModelProvider } from '../src/types'

type EventOf<TType extends ChatEvent['type']> = Extract<ChatEvent, { type: TType }>
const isEventType =
  <TType extends ChatEvent['type']>(type: TType) =>
  (event: ChatEvent): event is EventOf<TType> =>
    event.type === type

// A provider whose ReAct decisions are scripted, with plan/execute present only
// to satisfy the ModelProvider interface (the ReAct runtime never calls them).
const scriptedProvider = (
  decisions: ReActDecision[],
  synthesize: ModelProvider['synthesize'],
  onSynthesize?: (ctx: ExecutionContext) => void
): ModelProvider => {
  let index = 0
  return {
    async plan() {
      return { complexity: 'low', steps: [] }
    },
    async execute() {
      return ''
    },
    async decideNextAction() {
      const decision = decisions[Math.min(index, decisions.length - 1)]
      index += 1
      return decision ?? { kind: 'final' }
    },
    async *synthesize(ctx, options) {
      onSynthesize?.(ctx)
      yield* synthesize(ctx, options)
    }
  }
}

const webSearchRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry()
  registry.register({
    id: 'web-search',
    description: 'test tool',
    schema: z.object({ query: z.string() }),
    async execute() {
      return { results: ['r1'] }
    }
  })
  return registry
}

describe('ReActRuntime', () => {
  it('loops until a final decision then synthesizes from accumulated observations', async () => {
    let observed: string[] = []
    const provider = scriptedProvider(
      [
        { kind: 'action', toolId: 'web-search', input: { query: 'hello' } },
        { kind: 'final' }
      ],
      async function* () {
        yield { kind: 'content' as const, text: 'answer' }
      },
      (ctx) => {
        observed = [...ctx.notes]
      }
    )

    const runtime = new ReActRuntime(provider, webSearchRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.find(isEventType('agent.run.started'))?.payload.agentType).toBe('react')
    expect(events.some((event) => event.type === 'agent.tool.completed')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
    // The tool observation must reach the synthesis context.
    expect(observed.some((note) => note.includes('web-search'))).toBe(true)
  })

  it('respects the maxIterations cap and still synthesizes', async () => {
    const provider = scriptedProvider(
      [{ kind: 'action', toolId: 'web-search', input: { query: 'loop' } }],
      async function* () {
        yield { kind: 'content' as const, text: 'capped' }
      }
    )

    const runtime = new ReActRuntime(provider, webSearchRegistry(), { maxIterations: 3 })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const toolStarts = events.filter((event) => event.type === 'agent.tool.started')
    expect(toolStarts).toHaveLength(3)
    expect(events.find(isEventType('agent.run.completed'))?.payload.steps).toBe(3)
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('capped')
  })

  it('stops cleanly when the signal is aborted mid-loop', async () => {
    const controller = new AbortController()
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        // Abort after the first decision so the next loop check stops the run.
        controller.abort()
        return { kind: 'action', toolId: 'web-search', input: { query: 'x' } }
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'should not reach' }
      }
    }

    const runtime = new ReActRuntime(provider, webSearchRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello', { signal: controller.signal })) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.run.completed')).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    const done = events.at(-1)
    expect(done?.type).toBe('assistant.done')
    expect(done?.type === 'assistant.done' && done.payload.source).toBe('')
  })

  it('reuses the shared rate-limit retry loop during synthesis', async () => {
    const retryAt = new Date(Date.now() + 1).toISOString()
    let attempts = 0
    const provider = scriptedProvider([{ kind: 'final' }], async function* () {
      attempts += 1
      if (attempts === 1) {
        throw new RateLimitError('rate limited', { retryAfterMs: 1, retryAt })
      }
      yield { kind: 'content' as const, text: 'recovered' }
    })

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(attempts).toBe(2)
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(true)
    expect(events.some((event) => event.type === 'rate.limit.recovered')).toBe(true)
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('recovered')
  })

  it('streams thoughts via streamDecision and carries the final thought on completion', async () => {
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async *streamDecision() {
        yield { kind: 'thought' as const, text: 'Let me' }
        yield { kind: 'thought' as const, text: 'Let me think' }
        yield { kind: 'decision' as const, decision: { kind: 'final' as const } }
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'answer' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const deltas = events.filter(isEventType('agent.step.delta'))
    expect(deltas).toHaveLength(2)
    expect(deltas.at(-1)?.payload.text).toBe('Let me think')
    // The think step's completion carries the final thought (persisted on reload).
    const completed = events.filter(isEventType('agent.step.completed'))
    expect(completed.some((event) => event.payload.summary === 'Let me think')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('surfaces an error when the provider cannot make ReAct decisions', async () => {
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'unused' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })
})
