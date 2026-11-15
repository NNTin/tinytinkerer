import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createChatRuntime,
  type ModelProvider,
  type RuntimeTimeoutError
} from '@tinytinkerer/app-core'
import { toolInputJsonSchema, type AgentType, type ChatEvent } from '@tinytinkerer/contracts'
import { LiteLLMProvider } from '../src/runtime/litellm-provider'

vi.mock('../src/telemetry/telemetry', async () => ({
  ...(await vi.importActual<typeof import('../src/telemetry/telemetry')>(
    '../src/telemetry/telemetry'
  )),
  getTelemetryHeaders: () => ({})
}))

// Issue #533: provider quota waits are an explicit pre-request cooldown, never a
// model response. Only the HTTP boundary is scripted; the SSE parser,
// LiteLLMProvider and its quota tracker, the app-core adapter and the runtimes
// all run for real under fake time.

const MODEL = 'openai/gpt-6.1-sol'
const DONE = 'data: [DONE]\n\n'
const encode = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const delta = (value: unknown) => encode({ choices: [{ delta: value }] })
const finish = (reason: string) => encode({ choices: [{ delta: {}, finish_reason: reason }] })
const sse = (text: string, headers: Record<string, string> = {}) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream', ...headers } })
const finalDecision = () => sse(delta({ content: 'Done' }) + finish('stop') + DONE)
const actionDecision = () =>
  sse(
    delta({
      tool_calls: [
        {
          index: 0,
          id: 'call_0',
          function: { name: 'mcp_srv_write', arguments: '{"value":"saved"}' }
        }
      ]
    }) +
      finish('tool_calls') +
      DONE
  )
const singleShotFinal = () =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Done' } }] }),
    { headers: { 'content-type': 'application/json' } }
  )
const answer = (headers: Record<string, string> = {}) =>
  sse(delta({ content: 'Answer' }) + DONE, headers)
const rateLimited = (retryAfterMs: number) =>
  new Response(
    JSON.stringify({
      code: 'rate_limited',
      error: 'Expected backoff',
      retryAfterMs,
      retryAt: new Date(Date.now() + retryAfterMs).toISOString()
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil(retryAfterMs / 1000))
      }
    }
  )
const requestQuota = (reset: string) => ({
  'x-ratelimit-limit-requests': '10',
  'x-ratelimit-remaining-requests': '0',
  'x-ratelimit-reset-requests': reset
})
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
// A single-shot request that only ends when its signal aborts.
const hang: Handler = (init) =>
  new Promise((_resolve, reject) =>
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  )
const softPacing = {
  'x-ratelimit-limit-requests': '100',
  'x-ratelimit-remaining-requests': '1',
  'x-ratelimit-reset-requests': '60'
}

type Handler = (init: RequestInit) => Response | Promise<Response>
type Kind = 'decision' | 'synthesis' | 'plan'

// A streamed decision the test drives after dispatch. The body honours the
// request signal like a real fetch, so runtime deadlines and user aborts end it.
const openDecision = () => {
  let body!: ReadableStreamDefaultController<Uint8Array>
  const handler: Handler = (init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller
        init.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('Aborted', 'AbortError'))
        )
      }
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  return {
    handler,
    send: (text: string) => body.enqueue(new TextEncoder().encode(text))
  }
}

type SetupOptions = {
  agentType?: AgentType
  nonStreamed?: boolean
  onForward?: () => void
  runtime?: Partial<Parameters<typeof createChatRuntime>[0]>
}

const setup = (options: SetupOptions = {}) => {
  const queues: Record<Kind, Handler[]> = { decision: [], synthesis: [], plan: [] }
  const dispatches: Array<{ kind: Kind; at: number; body: string }> = []
  const fetch = vi.fn(async (_url: unknown, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : '{}'
    const request = JSON.parse(body) as { tool_choice?: string; response_format?: unknown }
    const kind: Kind = request.response_format
      ? 'plan'
      : request.tool_choice === 'auto'
        ? 'decision'
        : 'synthesis'
    dispatches.push({ kind, at: Date.now(), body })
    const handler = queues[kind].shift()
    if (!handler) throw new Error(`Unexpected ${kind} request`)
    return handler(init)
  })
  vi.stubGlobal('fetch', fetch)
  const execute = vi
    .fn<(input: unknown) => Promise<{ saved: boolean }>>()
    .mockResolvedValue({ saved: true })
  const schema = z.object({ value: z.string() })
  const real = new LiteLLMProvider({
    baseUrl: 'https://edge.test',
    getModel: () => MODEL,
    getToken: () => 'private-token',
    ...(options.agentType === 'plan-execute'
      ? {}
      : {
          allToolDescriptors: [
            { id: 'mcp:srv:write', description: 'Write', inputSchema: toolInputJsonSchema(schema) }
          ]
        }),
    ...(options.onForward ? { onForwardRequest: () => options.onForward!() } : {})
  })
  // The single-shot path: the real provider's methods without streamDecision.
  const provider: ModelProvider = options.nonStreamed
    ? {
        decisionStreamLifecycle: real.decisionStreamLifecycle,
        plan: real.plan.bind(real),
        execute: real.execute.bind(real),
        synthesize: real.synthesize.bind(real),
        decideNextAction: real.decideNextAction.bind(real)
      }
    : real
  const errors: Error[] = []
  const runtime = createChatRuntime({
    provider,
    agentType: options.agentType ?? 'react',
    maxIterations: 3,
    tools: [{ id: 'mcp:srv:write', description: 'Write', schema, execute }],
    reportError: (error) => errors.push(error),
    ...options.runtime
  })
  const start = () => {
    const controller = new AbortController()
    const events: ChatEvent[] = []
    let settled = false
    const done = (async () => {
      for await (const event of runtime.run('private-prompt', { signal: controller.signal }))
        events.push(event)
      settled = true
    })()
    return { controller, events, done, settled: () => settled }
  }
  const of = <T extends ChatEvent['type']>(events: ChatEvent[], type: T) =>
    events.filter((event): event is Extract<ChatEvent, { type: T }> => event.type === type)
  const count = (kind: Kind) => dispatches.filter((dispatch) => dispatch.kind === kind).length
  // Turn 1 primes the tracker from its synthesis response headers.
  const prime = async (headers: Record<string, string>) => {
    queues.decision.push(options.nonStreamed ? singleShotFinal : finalDecision)
    queues.synthesis.push(() => answer(headers))
    const turn = start()
    await tick()
    await turn.done
    dispatches.length = 0
    fetch.mockClear()
  }
  return { queues, dispatches, fetch, execute, errors, start, of, count, prime }
}

const timeouts = (errors: Error[]) =>
  errors.filter((error) => error.name === 'RuntimeTimeoutError') as RuntimeTimeoutError[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

for (const agentType of ['react', 'hybrid'] as const) {
  describe(`${agentType}: pre-request quota cooldown (#533)`, () => {
    const plan = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  complexity: 'low',
                  steps: [{ id: 'work', summary: 'Work', toolCall: null }]
                })
              }
            }
          ]
        }),
        { headers: { 'content-type': 'application/json' } }
      )

    it('waits out a 120s request-quota reset beyond the 90s response budget, then dispatches once with a fresh budget', async () => {
      const f = setup({ agentType })
      if (agentType === 'hybrid') f.queues.plan.push(plan, plan)
      await f.prime(requestQuota('120'))
      const decision = openDecision()
      f.queues.decision.push(decision.handler)
      f.queues.synthesis.push(() => answer())
      const turn = f.start()
      await tick()

      const [waiting] = f.of(turn.events, 'rate.limit.waiting')
      expect(waiting?.payload).toMatchObject({
        message: 'Waiting for the model request quota to reset',
        autoRetry: true
      })
      expect(waiting!.payload.retryAfterMs).toBeGreaterThanOrEqual(120_050)
      expect(waiting!.payload.retryAfterMs).toBeLessThanOrEqual(120_300)
      expect(f.count('decision')).toBe(0)

      // Well past the 90s first-response budget, still only waiting on quota.
      await tick(119_000)
      expect(f.count('decision')).toBe(0)
      expect(f.of(turn.events, 'error')).toEqual([])
      expect(timeouts(f.errors)).toEqual([])

      await tick(1_400)
      expect(f.count('decision')).toBe(1)
      expect(f.dispatches.at(-1)!.at).toBe(Date.parse(waiting!.payload.retryAt))
      expect(f.of(turn.events, 'rate.limit.recovered')).toHaveLength(1)

      // The first-response budget starts at that dispatch: 89s of silence is fine.
      await tick(89_000)
      expect(timeouts(f.errors)).toEqual([])
      decision.send(delta({ content: 'Done' }) + finish('stop') + DONE)
      await turn.done

      expect(f.count('decision')).toBe(1)
      expect(f.count('synthesis')).toBe(1)
      expect(f.of(turn.events, 'rate.limit.waiting')).toHaveLength(1)
      expect(f.of(turn.events, 'assistant.done').at(-1)?.payload.source).toBe('Answer')
      expect(f.errors).toEqual([])
    })
  })
}

describe('pre-request quota cooldown (#533)', () => {
  it('times a real first-response delay from dispatch, not from the quota wait', async () => {
    const f = setup()
    await f.prime(requestQuota('120'))
    f.queues.decision.push(openDecision().handler)
    const turn = f.start()
    await tick(120_300)
    expect(f.count('decision')).toBe(1)
    const dispatchedAt = Date.now()
    await tick(90_000)
    await turn.done

    const [timeout] = timeouts(f.errors)
    expect(timeout?.diagnostics).toMatchObject({ cause: 'first_response', budgetMs: 90_000 })
    expect(timeout!.diagnostics!.elapsedMs).toBeGreaterThanOrEqual(89_999)
    expect(timeout!.diagnostics!.elapsedMs).toBeLessThan(91_000)
    expect(Date.now() - dispatchedAt).toBeLessThan(91_000)
    expect(f.count('decision')).toBe(1)
  })

  it('times a real stream-idle gap from the last progress after dispatch', async () => {
    const f = setup()
    await f.prime(requestQuota('120'))
    const decision = openDecision()
    f.queues.decision.push(decision.handler)
    const turn = f.start()
    await tick(120_300)
    decision.send(delta({ content: 'Thinking' }))
    await tick(14_000)
    expect(timeouts(f.errors)).toEqual([])
    await tick(1_000)
    await turn.done

    expect(timeouts(f.errors)[0]?.diagnostics).toMatchObject({
      cause: 'idle',
      lastPhase: 'content',
      budgetMs: 15_000
    })
  })

  it('covers token-quota waits with the same single cooldown', async () => {
    const f = setup()
    await f.prime({
      'x-ratelimit-limit-tokens': '1000',
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-tokens': '30'
    })
    f.queues.decision.push(finalDecision)
    f.queues.synthesis.push(() => answer())
    const turn = f.start()
    await tick()
    const [waiting] = f.of(turn.events, 'rate.limit.waiting')
    expect(waiting?.payload.message).toBe('Waiting for the model token quota to reset')
    expect(f.count('decision')).toBe(0)
    await tick(30_300)
    await turn.done
    expect(f.count('decision')).toBe(1)
    expect(f.count('synthesis')).toBe(1)
    expect(f.of(turn.events, 'rate.limit.waiting')).toHaveLength(1)
  })

  it('cancels promptly 1s into a quota wait: no timers remain and no request follows', async () => {
    const f = setup()
    await f.prime(requestQuota('120'))
    const turn = f.start()
    await tick(1_000)
    turn.controller.abort()
    await tick()

    expect(turn.settled()).toBe(true)
    expect(f.of(turn.events, 'rate.limit.cancelled')[0]?.payload.reason).toBe('cancelled')
    expect(vi.getTimerCount()).toBe(0)
    await tick(600_000)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.errors).toEqual([])
  })

  it('cancellation at the dispatch boundary after the wait issues no request', async () => {
    const active: { controller?: AbortController } = {}
    const f = setup({ onForward: () => active.controller?.abort() })
    await f.prime(requestQuota('120'))
    const turn = f.start()
    active.controller = turn.controller
    await tick(120_300)
    await turn.done

    expect(f.of(turn.events, 'rate.limit.recovered')).toHaveLength(1)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.of(turn.events, 'error')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    expect(f.errors).toEqual([])
  })

  it('treats malformed reset data as the bounded default renewal window', async () => {
    const f = setup()
    await f.prime(requestQuota('soon'))
    f.queues.decision.push(finalDecision)
    f.queues.synthesis.push(() => answer())
    const turn = f.start()
    await tick()
    const waitMs = f.of(turn.events, 'rate.limit.waiting')[0]!.payload.retryAfterMs
    expect(waitMs).toBeGreaterThanOrEqual(60_050)
    expect(waitMs).toBeLessThanOrEqual(60_300)
    await tick(60_300)
    await turn.done
    expect(f.count('decision')).toBe(1)
  })

  it('does not wait for an expired reset', async () => {
    const f = setup()
    await f.prime(requestQuota(String(Math.floor(Date.now() / 1000) - 10)))
    f.queues.decision.push(finalDecision)
    f.queues.synthesis.push(() => answer())
    const turn = f.start()
    await tick()
    await turn.done
    expect(f.of(turn.events, 'rate.limit.waiting')).toEqual([])
    expect(f.count('decision')).toBe(1)
  })

  it('ends a reset beyond the cooldown bound as a typed rate-limit outcome without any request', async () => {
    const f = setup()
    await f.prime(requestQuota('400'))
    const turn = f.start()
    await tick()
    await turn.done

    const reasons = f.of(turn.events, 'rate.limit.cancelled').map((e) => e.payload.reason)
    expect(reasons).toEqual(['too_long', 'too_long'])
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.of(turn.events, 'assistant.done').at(-1)?.payload.source).toMatch(/rate limited/)
    expect(f.of(turn.events, 'error')).toEqual([])
    expect(f.errors).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honours the configured per-wait cap and run cooldown deadline', async () => {
    const tight = setup({ runtime: { maxCooldownMs: 100_000 } })
    await tight.prime(requestQuota('120'))
    const first = tight.start()
    await tick()
    await first.done
    expect(tight.of(first.events, 'rate.limit.cancelled')[0]?.payload.reason).toBe('too_long')

    const run = setup({ runtime: { runCooldownDeadlineMs: 100_000 } })
    await run.prime(requestQuota('120'))
    const second = run.start()
    await tick()
    await second.done
    expect(run.of(second.events, 'rate.limit.cancelled')[0]?.payload.reason).toBe('run_limit')
    expect(run.fetch).toHaveBeenCalledTimes(0)
  })

  it('recovers an ordinary 429 with one wait and replays no completed tool call', async () => {
    const f = setup()
    f.queues.decision.push(actionDecision, () => rateLimited(1_000), finalDecision)
    f.queues.synthesis.push(() => answer())
    const turn = f.start()
    await tick()
    const [waiting] = f.of(turn.events, 'rate.limit.waiting')
    // One deadline: the anti-storm 1.1x amplification plus jitter, applied once.
    expect(waiting!.payload.retryAfterMs).toBeGreaterThanOrEqual(1_150)
    expect(waiting!.payload.retryAfterMs).toBeLessThanOrEqual(1_401)
    await tick(1_401)
    await turn.done

    expect(f.of(turn.events, 'rate.limit.waiting')).toHaveLength(1)
    expect(f.count('decision')).toBe(3)
    // The retry dispatches exactly at the deadline: no second, inline wait.
    expect(f.dispatches.filter((d) => d.kind === 'decision')[2]!.at).toBe(
      Date.parse(waiting!.payload.retryAt)
    )
    // The completed observation is carried into the retried request.
    expect(f.dispatches.filter((d) => d.kind === 'decision')[2]!.body).toContain('saved')
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.of(turn.events, 'assistant.done').at(-1)?.payload.source).toBe('Answer')
    expect(f.errors).toEqual([])
  })

  it('stops a 429 beyond the bound without retrying, keeping the completed tool result', async () => {
    const f = setup()
    f.queues.decision.push(actionDecision, () => rateLimited(400_000))
    const turn = f.start()
    await tick()
    await turn.done

    expect(f.of(turn.events, 'agent.tool.completed')).toHaveLength(1)
    expect(f.execute).toHaveBeenCalledTimes(1)
    // The decision 429 and the synthesis heuristic wait both end bounded.
    expect(f.of(turn.events, 'rate.limit.cancelled').map((e) => e.payload.reason)).toEqual([
      'too_long',
      'too_long'
    ])
    expect(f.count('decision')).toBe(2)
    expect(f.count('synthesis')).toBe(0)
    expect(timeouts(f.errors)).toEqual([])
  })

  it('covers the single-shot decision path outside its whole-response budget', async () => {
    const f = setup({ nonStreamed: true })
    await f.prime(requestQuota('120'))
    f.queues.decision.push(singleShotFinal)
    f.queues.synthesis.push(() => answer())
    const turn = f.start()
    await tick(120_300)
    await turn.done

    expect(f.of(turn.events, 'rate.limit.waiting')).toHaveLength(1)
    expect(f.count('decision')).toBe(1)
    expect(f.errors).toEqual([])
  })

  it('covers synthesis: waits once, then streams; cancels promptly during the wait', async () => {
    const f = setup({ agentType: 'plan-execute' })
    f.queues.synthesis.push(
      () => answer(requestQuota('120')),
      () => answer()
    )
    const first = f.start()
    await tick()
    await first.done
    f.dispatches.length = 0

    const second = f.start()
    await tick()
    expect(f.of(second.events, 'rate.limit.waiting')).toHaveLength(1)
    expect(f.count('synthesis')).toBe(0)
    await tick(120_300)
    await second.done
    expect(f.count('synthesis')).toBe(1)
    expect(f.of(second.events, 'assistant.done').at(-1)?.payload.source).toBe('Answer')

    const g = setup({ agentType: 'plan-execute' })
    g.queues.synthesis.push(() => answer(requestQuota('120')))
    const primed = g.start()
    await tick()
    await primed.done
    g.dispatches.length = 0
    g.fetch.mockClear()
    const third = g.start()
    await tick(1_000)
    third.controller.abort()
    await tick()
    expect(third.settled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await tick(300_000)
    expect(g.count('synthesis')).toBe(0)
  })

  it('aborts sub-second pacing inline without dispatching', async () => {
    const f = setup()
    await f.prime(softPacing)
    const turn = f.start()
    await tick(10)
    expect(f.of(turn.events, 'rate.limit.waiting')).toEqual([])
    turn.controller.abort()
    await tick()
    expect(turn.settled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await tick(5_000)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('starts the single-shot budget at dispatch, after inline pacing', async () => {
    const f = setup({ nonStreamed: true })
    await f.prime(softPacing)
    f.queues.decision.push(hang)
    const turn = f.start()
    await tick(1_000)
    expect(f.count('decision')).toBe(1)
    const paced = f.dispatches[0]!.at - Date.parse('2026-11-15T00:00:00Z')
    // The prime turn took no time, so dispatch waited out 450-700ms of pacing.
    expect(paced).toBeGreaterThanOrEqual(450)
    expect(paced).toBeLessThanOrEqual(700)
    await tick(f.dispatches[0]!.at + 89_990 - Date.now())
    expect(timeouts(f.errors)).toEqual([])
    await tick(20)
    await turn.done
    expect(timeouts(f.errors).map((error) => error.message)).toEqual(['ReAct decision timed out'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a single-shot decision during pacing and at dispatch without a request', async () => {
    const f = setup({ nonStreamed: true })
    await f.prime(softPacing)
    const paced = f.start()
    await tick(10)
    paced.controller.abort()
    await tick()
    expect(paced.settled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    const active: { controller?: AbortController } = {}
    const g = setup({ nonStreamed: true, onForward: () => active.controller?.abort() })
    await g.prime(requestQuota('120'))
    const turn = g.start()
    active.controller = turn.controller
    await tick(120_300)
    await turn.done
    expect(f.fetch).not.toHaveBeenCalled()
    expect(g.fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect([...f.errors, ...g.errors]).toEqual([])
  })

  // 100s of healthy model progress, then a completed tool call.
  const slowAction = (decision: ReturnType<typeof openDecision>) => async () => {
    for (let second = 0; second < 100; second += 10) {
      decision.send(delta({ content: `step ${second}` }))
      await tick(10_000)
    }
    decision.send(
      delta({
        tool_calls: [
          {
            index: 0,
            id: 'call_0',
            function: { name: 'mcp_srv_write', arguments: '{"value":"saved"}' }
          }
        ]
      }) +
        finish('tool_calls') +
        DONE
    )
  }

  for (const rollback of [false, true]) {
    it(`charges prior run time against the cooldown deadline for decisions and synthesis${rollback ? ' despite a wall-clock rollback' : ''}`, async () => {
      const f = setup({ runtime: { runCooldownDeadlineMs: 150_000 } })
      const decision = openDecision()
      f.queues.decision.push(decision.handler, () => {
        if (rollback) vi.setSystemTime(Date.now() - 3_600_000)
        return rateLimited(60_000)
      })
      const turn = f.start()
      await tick()
      await slowAction(decision)()
      await turn.done

      // A ~66s cooldown alone fits 150s, but the deadline is anchored at run
      // start: 100s of model time + 66s > 150s. Synthesis shares that deadline.
      const reasons = f.of(turn.events, 'rate.limit.cancelled').map((e) => e.payload.reason)
      const waits = f.of(turn.events, 'rate.limit.waiting')
      expect(waits).toEqual([])
      expect(reasons).toEqual(['run_limit', 'run_limit'])
      expect(f.count('decision')).toBe(2)
      expect(f.count('synthesis')).toBe(0)
      expect(f.of(turn.events, 'agent.tool.completed')).toHaveLength(1)
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(timeouts(f.errors)).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })
  }
})
