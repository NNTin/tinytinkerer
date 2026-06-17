import type { ChatEvent, ReActDecision } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RateLimitError } from '../src/errors/rate-limit-error'
import { isRuntimeTimeoutError } from '../src/errors/timeout-error'
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
      [{ kind: 'action', toolId: 'web-search', input: { query: 'hello' } }, { kind: 'final' }],
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

  it('nests the tool run under the act step with its own stepId', async () => {
    const provider = scriptedProvider(
      [{ kind: 'action', toolId: 'web-search', input: { query: 'hello' } }, { kind: 'final' }],
      async function* () {
        yield { kind: 'content' as const, text: 'answer' }
      }
    )

    const runtime = new ReActRuntime(provider, webSearchRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const actStep = events
      .filter(isEventType('agent.step.started'))
      .find((event) => event.payload.kind === 'act')
    const toolStarted = events.find(isEventType('agent.tool.started'))

    expect(actStep).toBeDefined()
    expect(toolStarted).toBeDefined()
    // The tool is a child of the act step, not the act step itself: distinct
    // stepId, parented under the act step (never self-parented).
    expect(toolStarted?.payload.stepId).not.toBe(actStep?.payload.stepId)
    expect(toolStarted?.payload.parentStepId).toBe(actStep?.payload.stepId)
  })

  it('stores tool results by toolId and accumulates repeated outputs', async () => {
    let observedToolResults: Record<string, unknown> = {}
    const provider = scriptedProvider(
      [
        { kind: 'action', toolId: 'web-search', input: { query: 'first' } },
        { kind: 'action', toolId: 'web-search', input: { query: 'second' } },
        { kind: 'final' }
      ],
      async function* () {
        yield { kind: 'content' as const, text: 'answer' }
      },
      (ctx) => {
        observedToolResults = { ...ctx.toolResults }
      }
    )

    const runtime = new ReActRuntime(provider, webSearchRegistry())
    for await (const _event of runtime.run('hello')) {
      void _event
    }

    expect(observedToolResults).toEqual({
      'web-search': [{ results: ['r1'] }, { results: ['r1'] }]
    })
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

  it('closes the synthesize step as failed on a non-rate-limit synthesis error', async () => {
    const provider = scriptedProvider([{ kind: 'final' }], async function* () {
      // eslint-disable-next-line require-yield
      throw new Error('synthesis boom')
    })

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const synthesizeStart = events
      .filter(isEventType('agent.step.started'))
      .find((event) => event.payload.kind === 'synthesize')
    expect(synthesizeStart).toBeDefined()
    const synthesizeStepId = synthesizeStart?.payload.stepId
    // The synthesize step must be closed (failed), not left open, before the run
    // surfaces the generic error.
    expect(
      events.some(
        (event) => event.type === 'agent.step.failed' && event.payload.stepId === synthesizeStepId
      )
    ).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('waits out a rate-limited decision and retries instead of failing the run', async () => {
    const retryAt = new Date(Date.now() + 1).toISOString()
    let attempts = 0
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        attempts += 1
        if (attempts === 1) {
          throw new RateLimitError('rate limited', { retryAfterMs: 1, retryAt })
        }
        return { kind: 'final' }
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'recovered' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(attempts).toBe(2)
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(true)
    expect(events.some((event) => event.type === 'rate.limit.recovered')).toBe(true)
    // The rate limit must not surface as a generic execution error.
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('recovered')
  })

  it('finishes gracefully when a decision rate limit is too long to auto-retry', async () => {
    // A cooldown beyond the auto-retry ceiling cancels the wait; the loop should
    // finish so synthesis still runs, rather than ending with a generic error.
    const retryAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        throw new RateLimitError('rate limited', { retryAfterMs: 10 * 60_000, retryAt })
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'composed anyway' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(
      events.some(
        (event) => event.type === 'rate.limit.cancelled' && event.payload.reason === 'too_long'
      )
    ).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('composed anyway')
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

  it('times out a stalled streaming decision and fails the step', async () => {
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async *streamDecision(_context, options) {
        yield { kind: 'thought' as const, text: 'thinking' }
        // Stall until aborted (the runtime's idle timeout should abort us).
        await new Promise<void>((resolve) => {
          const signal = options?.signal
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'unused' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry(), { stepTimeoutMs: 5 })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.step.failed')).toBe(true)
    expect(
      events.some(
        (event) => event.type === 'error' && event.payload.message === 'ReAct decision timed out'
      )
    ).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('does not cut off a slow first chunk within the first-chunk budget (FRONTEND-S)', async () => {
    // A slow reasoning model (e.g. openai/gpt-5 via LiteLLM) takes longer than
    // the inter-chunk idle gap to emit its first token. The larger
    // firstChunkTimeoutMs must govern that first wait — the short stepTimeoutMs
    // idle gap only applies once tokens flow — so the stream is not killed before
    // it starts.
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async *streamDecision() {
        // First token arrives after the idle gap but within the first-chunk budget.
        await new Promise<void>((resolve) => setTimeout(resolve, 40))
        yield { kind: 'thought' as const, text: 'thinking' }
        yield { kind: 'decision' as const, decision: { kind: 'final' as const } }
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'answer' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry(), {
      stepTimeoutMs: 5,
      firstChunkTimeoutMs: 500
    })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(
      events.some(
        (event) => event.type === 'error' && event.payload.message === 'ReAct decision timed out'
      )
    ).toBe(false)
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

  it('reports a terminal error to the injected reportError sink', async () => {
    const reported: Error[] = []
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async *streamDecision(_context, options) {
        yield { kind: 'thought' as const, text: 'thinking' }
        // Stall until the runtime's idle timeout aborts us.
        await new Promise<void>((resolve) => {
          const signal = options?.signal
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'unused' }
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry(), {
      stepTimeoutMs: 5,
      reportError: (error) => reported.push(error)
    })
    for await (const _event of runtime.run('hello')) {
      // drain
    }

    expect(reported).toHaveLength(1)
    expect(reported[0]).toBeInstanceOf(Error)
    expect(reported[0]?.message).toBe('ReAct decision timed out')
    // Typed as a RuntimeTimeoutError so the host's telemetry sink can report it
    // as a warning rather than a hard error (FRONTEND-S).
    expect(isRuntimeTimeoutError(reported[0])).toBe(true)
  })

  it('does not report an AbortError to the reportError sink', async () => {
    const reported: Error[] = []
    const provider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        return { kind: 'final' }
      },
      // eslint-disable-next-line require-yield
      async *synthesize() {
        // The user cancelled mid-synthesis: surfaces as an AbortError, which the
        // terminal handler treats as a clean stop, not a reportable issue.
        const error = new Error('Aborted')
        error.name = 'AbortError'
        throw error
      }
    }

    const runtime = new ReActRuntime(provider, new ToolRegistry(), {
      reportError: (error) => reported.push(error)
    })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(reported).toHaveLength(0)
    // No error notice on a clean abort, and the run still ends with a done event.
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })
})
