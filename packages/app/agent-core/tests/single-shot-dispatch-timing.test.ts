import type { ChatEvent } from '@tinytinkerer/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ModelProvider, ProviderCallOptions } from '../src/types'

// Issue #533: a single-shot decision's whole-response budget starts at the
// provider's dispatch notification for explicit request-start providers, and at
// invocation (unchanged) for legacy providers.
const provider = (explicit: boolean, preRequestMs: number): ModelProvider => ({
  ...(explicit ? { decisionStreamLifecycle: 'explicit-request-start' as const } : {}),
  plan: () => Promise.resolve({ complexity: 'low', steps: [] }),
  execute: () => Promise.resolve(''),
  synthesize: async function* () {
    yield await Promise.resolve({ kind: 'content' as const, text: 'Answer' })
  },
  async decideNextAction(_context, options?: ProviderCallOptions) {
    await new Promise((resolve) => setTimeout(resolve, preRequestMs))
    options?.onRequestStart?.()
    // The dispatched request never answers.
    return new Promise(() => {})
  }
})

const run = (model: ModelProvider) => {
  const errors: Error[] = []
  const events: ChatEvent[] = []
  const runtime = new ReActRuntime(model, new ToolRegistry(), {
    firstChunkTimeoutMs: 90_000,
    reportError: (error) => errors.push(error)
  })
  const done = (async () => {
    for await (const event of runtime.run('prompt')) events.push(event)
  })()
  return { errors, events, done }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('single-shot decision dispatch timing (#533)', () => {
  it('times an explicit request-start provider from dispatch, not invocation', async () => {
    const r = run(provider(true, 60_000))
    await vi.advanceTimersByTimeAsync(149_999)
    expect(r.errors).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await r.done
    expect(r.errors.map((error) => error.message)).toEqual(['ReAct decision timed out'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps legacy providers timed from invocation', async () => {
    const r = run(provider(false, 60_000))
    await vi.advanceTimersByTimeAsync(90_000)
    await r.done
    expect(r.errors.map((error) => error.message)).toEqual(['ReAct decision timed out'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms no budget when a provider settles before dispatching', async () => {
    const r = run({
      ...provider(true, 0),
      decideNextAction: () => Promise.reject(new Error('quota check failed'))
    })
    await vi.advanceTimersByTimeAsync(0)
    await r.done
    expect(r.errors.map((error) => error.message)).toEqual(['quota check failed'])
    expect(vi.getTimerCount()).toBe(0)
  })
})
