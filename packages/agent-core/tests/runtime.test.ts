import type { ChatEvent } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { RateLimitError } from '../src/errors/rate-limit-error'
import { AgentRuntime } from '../src/runtime/agent-runtime'
import { ToolRegistry } from '../src/tools/registry'
import { z } from 'zod'
import type { ModelProvider, ProviderCallOptions } from '../src/types'

const inferPlan = (prompt: string, options?: { searchEnabled?: boolean }) => {
  const searchEnabled = options?.searchEnabled !== false
  const shouldSearch = /latest|news|search|web|compare|today|research/i.test(prompt)
  return {
    complexity: searchEnabled && shouldSearch ? ('medium' as const) : ('low' as const),
    steps:
      searchEnabled && shouldSearch
        ? [
            { id: 'understand', summary: 'Understand request constraints' },
            {
              id: 'search',
              summary: 'Collect current references from web search',
              toolCall: { toolId: 'web-search', input: { query: prompt, maxResults: 5 } }
            },
            { id: 'compose', summary: 'Compose final answer' }
          ]
        : [
            { id: 'understand', summary: 'Understand request constraints' },
            { id: 'compose', summary: 'Compose final answer' }
          ]
  }
}

type EventOf<TType extends ChatEvent['type']> = Extract<ChatEvent, { type: TType }>

const isEventType =
  <TType extends ChatEvent['type']>(type: TType) =>
  (event: ChatEvent): event is EventOf<TType> =>
    event.type === type

const provider: ModelProvider = {
  async plan() {
    return {
      complexity: 'low',
      steps: [
        {
          id: 'search',
          summary: 'Search web',
          toolCall: {
            toolId: 'web-search',
            input: { query: 'hello' }
          }
        }
      ]
    }
  },
  async execute() {
    return 'ok'
  },
  async *synthesize() {
    yield 'hi '
    yield 'there'
  }
}

describe('AgentRuntime', () => {
  it('emits core planning, execution and assistant events', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'test tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        return { count: 1 }
      }
    })

    const runtime = new AgentRuntime(provider, registry)
    const events = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'plan.generated')).toBe(true)
    expect(events.some((event) => event.type === 'tool.call.completed')).toBe(true)
    expect(events.some((event) => event.type === 'execution.completed')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('emits tool failure when tool exceeds timeout', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'slow tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { count: 1 }
      }
    })

    const runtime = new AgentRuntime(provider, registry, { toolTimeoutMs: 1 })
    const events = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'tool.call.failed')).toBe(true)
  })

  it('waits and retries synthesis after a short rate limit', async () => {
    const retryAt = new Date(Date.now() + 1).toISOString()
    let attempts = 0
    const retryingProvider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return 'ok'
      },
      async *synthesize() {
        attempts += 1
        if (attempts === 1) {
          yield 'partial '
          throw new RateLimitError('rate limited', { retryAfterMs: 1, retryAt })
        }
        yield 'retried'
      }
    }

    const runtime = new AgentRuntime(retryingProvider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(attempts).toBe(2)
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(true)
    expect(events.some((event) => event.type === 'rate.limit.recovered')).toBe(true)
    const latestAssistantChunk = [...events].reverse().find(isEventType('assistant.chunk'))
    expect(latestAssistantChunk?.payload.source).toBe('retried')
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('retried')
  })

  it('cancels synthesis after a long rate limit', async () => {
    const retryAt = new Date(Date.now() + 301_000).toISOString()
    let attempts = 0
    const longRateLimitProvider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return 'ok'
      },
      async *synthesize() {
        attempts += 1
        throw new RateLimitError('rate limited', { retryAfterMs: 301_000, retryAt })
      }
    }

    const runtime = new AgentRuntime(longRateLimitProvider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(attempts).toBe(1)
    expect(events.find(isEventType('rate.limit.cancelled'))?.payload.reason).toBe('too_long')
  })

  it('allows cancelling a pending short rate-limit retry', async () => {
    vi.useFakeTimers()
    const retryAt = new Date(Date.now() + 60_000).toISOString()
    const controller = new AbortController()
    const cancellingProvider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return 'ok'
      },
      async *synthesize() {
        throw new RateLimitError('rate limited', { retryAfterMs: 60_000, retryAt })
      }
    }

    const runtime = new AgentRuntime(cancellingProvider, new ToolRegistry())
    const iterator = runtime.run('hello', { signal: controller.signal })
    const events: ChatEvent[] = []

    while (true) {
      const next = await iterator.next()
      if (next.done) {
        break
      }
      events.push(next.value)
      if (next.value.type === 'rate.limit.waiting') {
        controller.abort()
        break
      }
    }

    while (true) {
      const next = await iterator.next()
      if (next.done) {
        break
      }
      events.push(next.value)
    }

    expect(events.find(isEventType('rate.limit.cancelled'))?.payload.reason).toBe('cancelled')
    vi.useRealTimers()
  })

  it('stops mid-execution and ends cleanly when signal is aborted', async () => {
    const controller = new AbortController()
    let stepCount = 0
    const multiStepProvider: ModelProvider = {
      async plan() {
        return {
          complexity: 'medium',
          steps: [
            { id: 'step-1', summary: 'Step one' },
            { id: 'step-2', summary: 'Step two' },
            { id: 'step-3', summary: 'Step three' }
          ]
        }
      },
      async execute(step) {
        stepCount += 1
        if (step.id === 'step-1') {
          controller.abort()
        }
        return `done: ${step.id}`
      },
      async *synthesize() {
        yield 'should not reach here'
      }
    }

    const runtime = new AgentRuntime(multiStepProvider, new ToolRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello', { signal: controller.signal })) {
      events.push(event)
    }

    expect(stepCount).toBe(1)
    expect(events.some((event) => event.type === 'execution.completed')).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('does not add empty execute() notes to context.notes', async () => {
    const capturedNotes: string[] = []
    const noNoteProvider: ModelProvider = {
      async plan() {
        return {
          complexity: 'low',
          steps: [{ id: 'understand', summary: 'Understand the request' }]
        }
      },
      async execute() {
        return ''
      },
      async *synthesize(ctx) {
        capturedNotes.push(...ctx.notes)
        yield 'done'
      }
    }

    const runtime = new AgentRuntime(noNoteProvider, new ToolRegistry())
    for await (const _ of runtime.run('hello')) {
      // consume events
    }

    expect(capturedNotes).toHaveLength(0)
  })

  it('passes prior conversation history into synthesis context', async () => {
    const capturedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const historyAwareProvider: ModelProvider = {
      async plan() {
        return { complexity: 'low', steps: [] }
      },
      async execute() {
        return 'ok'
      },
      async *synthesize(ctx) {
        capturedHistory.push(...ctx.history)
        yield 'done'
      }
    }

    const runtime = new AgentRuntime(historyAwareProvider, new ToolRegistry())
    const history = [
      { role: 'user' as const, content: 'hello, my name is Tin' },
      { role: 'assistant' as const, content: 'Hello Tin!' }
    ]

    for await (const _ of runtime.run('Do you know my name?', { history })) {
      // consume events
    }

    expect(capturedHistory).toEqual(history)
  })

  it('adds tool result notes but not fake notes for non-tool steps', async () => {
    const capturedNotes: string[] = []
    const mixedProvider: ModelProvider = {
      async plan() {
        return {
          complexity: 'medium',
          steps: [
            {
              id: 'search',
              summary: 'Search web',
              toolCall: { toolId: 'web-search', input: { query: 'hello' } }
            },
            { id: 'compose', summary: 'Compose final response' }
          ]
        }
      },
      async execute(step, ctx) {
        if (step.toolCall) {
          const result = ctx.toolResults[step.id]
          return result !== undefined ? `${step.id}: ${JSON.stringify(result)}` : ''
        }
        return ''
      },
      async *synthesize(ctx) {
        capturedNotes.push(...ctx.notes)
        yield 'done'
      }
    }

    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'test tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        return { results: ['r1'] }
      }
    })

    const runtime = new AgentRuntime(mixedProvider, registry)
    for await (const _ of runtime.run('hello')) {
      // consume events
    }

    expect(capturedNotes).toHaveLength(1)
    expect(capturedNotes[0]).toContain('search:')
    expect(capturedNotes[0]).not.toContain('Completed step:')
  })

  it('does not emit tool.call.started or tool.call.failed for search when searchEnabled is false', async () => {
    const searchProvider: ModelProvider = {
      plan: (prompt: string, options?: ProviderCallOptions) => {
        const searchEnabled = options?.searchEnabled
        return Promise.resolve(inferPlan(prompt, searchEnabled !== undefined ? { searchEnabled } : undefined))
      },
      async execute() {
        return 'ok'
      },
      async *synthesize() {
        yield 'done'
      }
    }

    const runtime = new AgentRuntime(searchProvider, new ToolRegistry(), { searchEnabled: false })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('What is the latest news on AI?')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'tool.call.started')).toBe(false)
    expect(events.some((event) => event.type === 'tool.call.failed')).toBe(false)
    const planEvent = events.find(isEventType('plan.generated'))
    expect(planEvent?.payload.plan.steps.every((s) => !s.toolCall)).toBe(true)
  })

  it('does not emit tool.call.started when tool calls are disabled', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'test tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        return {}
      }
    })

    const runtime = new AgentRuntime(provider, registry, { maxToolCallsPerStep: 0 })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'tool.call.started')).toBe(false)
    expect(events.some((event) => event.type === 'tool.call.failed')).toBe(true)
  })
})
