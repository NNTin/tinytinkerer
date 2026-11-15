import type { ChatEvent } from '@tinytinkerer/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitError } from '../src/errors/rate-limit-error'
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

const run = (model: ModelProvider, signal?: AbortSignal) => {
  const errors: Error[] = []
  const events: ChatEvent[] = []
  const runtime = new ReActRuntime(model, new ToolRegistry(), {
    firstChunkTimeoutMs: 90_000,
    reportError: (error) => errors.push(error)
  })
  const done = (async () => {
    for await (const event of runtime.run('prompt', signal ? { signal } : {})) events.push(event)
  })()
  return { errors, events, done }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

// An explicit provider that cooperates with its signal: it waits `preRequestMs`,
// then dispatches (recorded) unless aborted, optionally reporting dispatch.
const cooperating = (preRequestMs: number, notify: boolean) => {
  const seen: { dispatched: boolean; signal: AbortSignal | undefined } = {
    dispatched: false,
    signal: undefined
  }
  const model: ModelProvider = {
    ...provider(true, 0),
    async decideNextAction(_context, options?: ProviderCallOptions) {
      seen.signal = options?.signal
      if (notify) options?.onRequestStart?.()
      await sleep(preRequestMs, options?.signal)
      options?.signal?.throwIfAborted()
      seen.dispatched = true
      return new Promise(() => {})
    }
  }
  return { model, seen }
}

const timedOut = (errors: Error[]) => errors.map((error) => error.message)

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

  it('bounds an explicit provider that never reports dispatch by the response ceiling', async () => {
    const r = run({ ...provider(true, 0), decideNextAction: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(299_999)
    expect(r.errors).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await r.done
    expect(timedOut(r.errors)).toEqual(['ReAct decision timed out'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a cooperating provider at either deadline so it never dispatches late', async () => {
    const silent = cooperating(400_000, false)
    const r = run(silent.model)
    await vi.advanceTimersByTimeAsync(300_000)
    await r.done
    expect(silent.seen.signal?.aborted).toBe(true)
    expect(timedOut(r.errors)).toEqual(['ReAct decision timed out'])
    await vi.advanceTimersByTimeAsync(200_000)
    expect(silent.seen.dispatched).toBe(false)

    const notified = cooperating(100_000, true)
    const n = run(notified.model)
    await vi.advanceTimersByTimeAsync(90_000)
    await n.done
    expect(notified.seen.signal?.aborted).toBe(true)
    expect(timedOut(n.errors)).toEqual(['ReAct decision timed out'])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(notified.seen.dispatched).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores repeated and late dispatch reports', async () => {
    const repeated = run({
      ...provider(true, 0),
      async decideNextAction(_context, options?: ProviderCallOptions) {
        options?.onRequestStart?.()
        await sleep(60_000)
        options?.onRequestStart?.()
        return new Promise(() => {})
      }
    })
    await vi.advanceTimersByTimeAsync(90_000)
    await repeated.done
    expect(timedOut(repeated.errors)).toEqual(['ReAct decision timed out'])

    let late: (() => void) | undefined
    const settled = run({
      ...provider(true, 0),
      decideNextAction: (_context, options?: ProviderCallOptions) => {
        late = options?.onRequestStart
        return Promise.reject(new Error('quota check failed'))
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    await settled.done
    late?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(400_000)
    expect(timedOut(settled.errors)).toEqual(['quota check failed'])
  })

  it('cancels before dispatch: the provider sees the abort and no timer remains', async () => {
    const user = new AbortController()
    const waiting = cooperating(60_000, false)
    const r = run(waiting.model, user.signal)
    await vi.advanceTimersByTimeAsync(1_000)
    user.abort()
    await vi.advanceTimersByTimeAsync(0)
    await r.done
    expect(waiting.seen.signal?.aborted).toBe(true)
    expect(waiting.seen.dispatched).toBe(false)
    expect(r.errors).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses cooldowns for a context without a run anchor instead of granting a fresh window', async () => {
    class Unanchored extends ReActRuntime {
      protected override createContext(prompt: string, history: []) {
        const context = super.createContext(prompt, history)
        delete context.runStartedAt
        return context
      }
    }
    const rateLimited = () =>
      Promise.reject(
        new RateLimitError('limited', {
          retryAfterMs: 1_000,
          retryAt: new Date(Date.now() + 1_000).toISOString()
        })
      )
    const events: ChatEvent[] = []
    const runtime = new Unanchored(
      { ...provider(true, 0), decideNextAction: rateLimited, synthesize: rateLimitedStream },
      new ToolRegistry()
    )
    const done = (async () => {
      for await (const event of runtime.run('prompt')) events.push(event)
    })()
    await vi.advanceTimersByTimeAsync(0)
    await done
    const reasons = events.flatMap((event) =>
      event.type === 'rate.limit.cancelled' ? [event.payload.reason] : []
    )
    expect(reasons).toEqual(['run_limit', 'run_limit'])
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(false)
  })
})

async function* rateLimitedStream(): AsyncGenerator<never> {
  yield* await Promise.resolve([])
  throw new RateLimitError('limited', {
    retryAfterMs: 1_000,
    retryAt: new Date(Date.now() + 1_000).toISOString()
  })
}
