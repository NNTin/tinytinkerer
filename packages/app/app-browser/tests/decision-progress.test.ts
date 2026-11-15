import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createChatRuntime, type RuntimeTimeoutError } from '@tinytinkerer/app-core'
import { toolInputJsonSchema, type ChatEvent } from '@tinytinkerer/contracts'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'
import { createRuntime } from '../src/runtime/create-runtime'
import { LiteLLMProvider } from '../src/runtime/litellm-provider'

vi.mock('../src/telemetry/telemetry', async () => ({
  ...(await vi.importActual<typeof import('../src/telemetry/telemetry')>(
    '../src/telemetry/telemetry'
  )),
  getTelemetryHeaders: () => ({})
}))

const MODEL = 'openai/gpt-6.1-sol'
const SECRET = 'private-argument-sentinel'
const encode = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const delta = (value: unknown) => encode({ choices: [{ delta: value }] })
const call = (args = '', name?: string, index = 0) =>
  delta({
    tool_calls: [
      {
        index,
        id: `call_${index}`,
        function: {
          ...(name !== undefined ? { name } : {}),
          arguments: args
        }
      }
    ]
  })
const finish = (reason = 'tool_calls') =>
  encode({ choices: [{ delta: {}, finish_reason: reason }] })
const response = (text: string) =>
  new Response(text, {
    headers: { 'content-type': 'text/event-stream' }
  })
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

type SetupOptions = {
  schema?: z.ZodType
  firstChunkTimeoutMs?: number
  stepTimeoutMs?: number
  decisionResponseTimeoutMs?: number
  retry?: boolean
  retryAfterAction?: boolean
  headerDelayMs?: number
  preRequestDelayMs?: number
}

// Only the HTTP boundary is scripted: production SSE parsing, native-call
// assembly, LiteLLMProvider, app-core error adapter and both runtimes all run.
const setup = async (agentType: 'react' | 'hybrid', options: SetupOptions = {}) => {
  let body!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller
    },
    cancel
  })
  let requests = 0
  let signal: AbortSignal | undefined
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      stream?: boolean
      tool_choice?: string
    }
    if (!request.stream) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  complexity: 'low',
                  steps: [{ id: 'work', summary: 'Complete work', toolCall: null }]
                })
              }
            }
          ]
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    }
    if (request.tool_choice === 'none')
      return response(delta({ content: 'Answer' }) + 'data: [DONE]\n\n')
    requests++
    if ((options.retry && requests === 1) || (options.retryAfterAction && requests === 2)) {
      return new Response(
        JSON.stringify({
          code: 'rate_limited',
          error: 'Expected backoff',
          retryAfterMs: 1_000,
          retryAt: new Date(Date.now() + 1_000).toISOString()
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } }
      )
    }
    if (requests > (options.retry ? 2 : 1)) {
      return response(delta({ content: 'Complete' }) + finish('stop') + 'data: [DONE]\n\n')
    }
    signal = init?.signal ?? undefined
    if (options.headerDelayMs) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true
        })
      })
    }
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetch)
  const execute = vi
    .fn<(input: unknown) => Promise<{ ok: boolean }>>()
    .mockResolvedValue({ ok: true })
  const errors: Error[] = []
  const events: ChatEvent[] = []
  const schema = options.schema ?? z.object({ value: z.string().optional() })
  const provider = new LiteLLMProvider({
    baseUrl: 'https://edge.test',
    getModel: () => MODEL,
    getToken: () => 'private-token',
    allToolDescriptors: [
      {
        id: 'mcp:srv:write',
        description: 'Write',
        inputSchema: toolInputJsonSchema(schema)
      }
    ]
  })
  if (options.preRequestDelayMs) {
    const original = provider.streamDecision.bind(provider)
    let pause = true
    vi.spyOn(provider, 'streamDecision').mockImplementation(async function* (context, callOptions) {
      // Exercise only the explicit-start contract, not #533's quota policy.
      if (pause) {
        pause = false
        await new Promise<void>((resolve) => setTimeout(resolve, options.preRequestDelayMs))
      }
      yield* original(context, callOptions)
    })
  }
  const runtime = createChatRuntime({
    provider,
    agentType,
    maxIterations: 2,
    tools: [
      {
        id: 'mcp:srv:write',
        description: 'Write',
        // Optional on purpose: malformed JSON must never fall back to {} and run.
        schema,
        execute
      }
    ],
    reportError: (error) => errors.push(error),
    ...options
  })
  const controller = new AbortController()
  const run = (async () => {
    for await (const event of runtime.run('private-prompt', { signal: controller.signal }))
      events.push(event)
  })()
  await tick()
  return {
    send: (text: string) => body.enqueue(new TextEncoder().encode(text)),
    close: () => body.close(),
    complete: () => {
      body.enqueue(new TextEncoder().encode(finish() + 'data: [DONE]\n\n'))
      body.close()
    },
    execute,
    errors,
    events,
    run,
    cancel,
    controller,
    fetch,
    signal: () => signal,
    requests: () => requests
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setCaptureExceptionSink(null)
})

for (const strategy of ['react', 'hybrid'] as const) {
  describe(`${strategy}: real streamed decision lifecycle (#530)`, () => {
    it('survives a preamble then 20s of argument fragments; executes once after completion', async () => {
      const f = await setup(strategy)
      f.send(delta({ content: 'I will write.' }))
      f.send(call('{"value":"', 'mcp_srv_write'))
      await tick()
      for (let i = 0; i < 20; i++) {
        await tick(1_000)
        f.send(call('a'))
        await tick()
        expect(f.execute).not.toHaveBeenCalled()
      }
      f.send(call('"}'))
      await tick()
      expect(f.execute).not.toHaveBeenCalled() // valid JSON alone is not completion
      f.complete()
      await f.run
      expect(f.execute).toHaveBeenCalledExactlyOnceWith({ value: 'a'.repeat(20) })
      expect(f.errors).toEqual([])
      const thoughts = f.events.filter((e) => e.type === 'agent.step.delta')
      expect(thoughts.map((e) => e.payload.text)).toEqual(['I will write.', 'Complete'])
    })

    it('allows tool-only assembly beyond the default 90s first-response window', async () => {
      const f = await setup(strategy)
      f.send(call('{"value":"', 'mcp_srv_'))
      await tick()
      f.send(call('', 'write')) // fragmented function name
      await tick()
      for (let i = 0; i < 100; i++) {
        await tick(1_000)
        f.send(call('a'))
        await tick()
      }
      expect(f.execute).not.toHaveBeenCalled()
      f.send(call('"}'))
      f.complete()
      await f.run
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.errors).toEqual([])
      expect(
        f.events.filter((e) => e.type === 'agent.step.delta').map((e) => e.payload.text)
      ).toEqual(['Complete'])
    })

    it('uses the first-response budget until meaningful progress, including while awaiting headers', async () => {
      const f = await setup(strategy, { firstChunkTimeoutMs: 90_000, headerDelayMs: 1 })
      await tick(15_001)
      expect(f.signal()?.aborted).toBe(false)
      await tick(74_999)
      await f.run
      expect(f.signal()?.aborted).toBe(true)
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toEqual({
        cause: 'first_response',
        lastPhase: 'request_started',
        elapsedMs: 90_000,
        budgetMs: 90_000,
        model: MODEL
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it('does not let comments, empty deltas, usage or id metadata end the first-response phase', async () => {
      const f = await setup(strategy)
      for (let i = 0; i < 9; i++) {
        f.send(
          ': heartbeat\n\n' +
            delta({ role: 'assistant', content: '', reasoning_content: '' }) +
            delta({
              tool_calls: [{ index: 0, id: 'same', type: 'function', function: { arguments: '' } }]
            }) +
            encode({ choices: [], usage: { prompt_tokens: 3 } })
        )
        await tick(10_000)
      }
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics?.cause).toBe('first_response')
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.events.filter((e) => e.type === 'agent.step.delta')).toEqual([])
    })

    it('times out stalled argument assembly despite repeated complete-name metadata', async () => {
      const f = await setup(strategy)
      f.send(delta({ content: 'Starting' }) + call(`{"value":"${SECRET}`, 'mcp_srv_write'))
      await tick()
      for (let i = 0; i < 3; i++) {
        await tick(5_000)
        if (!f.signal()?.aborted) {
          f.send(call('', 'mcp_srv_write'))
          await tick()
        }
      }
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toEqual({
        cause: 'argument_assembly',
        lastPhase: 'tool_call',
        elapsedMs: 15_000,
        budgetMs: 15_000,
        model: MODEL
      })
      const diagnostic = JSON.stringify(f.errors[0])
      for (const secret of [SECRET, 'private-token', 'private-prompt', 'mcp_srv_write'])
        expect(diagnostic).not.toContain(secret)
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.cancel).toHaveBeenCalledTimes(1)
    })

    it('keeps argument-assembly cause separate from the last reasoning phase', async () => {
      const f = await setup(strategy)
      f.send(call('{"value":', 'mcp_srv_write'))
      await tick()
      await tick(1_000)
      f.send(delta({ reasoning_content: 'Still preparing' }))
      await tick()
      await tick(15_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toMatchObject({
        cause: 'argument_assembly',
        lastPhase: 'reasoning',
        elapsedMs: 16_000
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it.each(['content', 'reasoning_content'])(
      'classifies an ordinary %s stall separately',
      async (channel) => {
        const f = await setup(strategy)
        f.send(delta({ [channel]: 'Thinking' }))
        await tick()
        await tick(15_000)
        await f.run
        expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toMatchObject({
          cause: 'idle',
          lastPhase: channel === 'content' ? 'content' : 'reasoning',
          elapsedMs: 15_000
        })
        expect(f.execute).not.toHaveBeenCalled()
      }
    )

    it('enforces a shorter absolute ceiling while still waiting for first response', async () => {
      const f = await setup(strategy, { decisionResponseTimeoutMs: 20_000 })
      await tick(20_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toEqual({
        cause: 'response_ceiling',
        lastPhase: 'request_started',
        elapsedMs: 20_000,
        budgetMs: 20_000,
        model: MODEL
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it('keeps the absolute ceiling fixed when wall time moves backwards', async () => {
      const f = await setup(strategy, { decisionResponseTimeoutMs: 25_000 })
      f.send(call('{"value":"', 'mcp_srv_write'))
      await tick()
      await tick(10_000)
      vi.setSystemTime(Date.now() - 60_000)
      f.send(call('a'))
      await tick()
      await tick(10_000)
      f.send(call('a'))
      await tick()
      await tick(5_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toMatchObject({
        cause: 'response_ceiling',
        elapsedMs: 25_000,
        budgetMs: 25_000
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it('enforces the finite response ceiling despite continuous argument progress', async () => {
      const f = await setup(strategy, { decisionResponseTimeoutMs: 25_000 })
      f.send(call('{"value":"', 'mcp_srv_write'))
      await tick()
      for (let i = 0; i < 24; i++) {
        await tick(1_000)
        f.send(call('a'))
        await tick()
      }
      await tick(1_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toEqual({
        cause: 'response_ceiling',
        lastPhase: 'tool_call',
        elapsedMs: 25_000,
        budgetMs: 25_000,
        model: MODEL
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it.each([
      {},
      { decisionResponseTimeoutMs: Infinity },
      { decisionResponseTimeoutMs: NaN },
      { decisionResponseTimeoutMs: 0 },
      { decisionResponseTimeoutMs: -1 }
    ])('keeps a finite default ceiling for omitted/invalid options: %j', async (options) => {
      const f = await setup(strategy, options)
      f.send(call('{"value":"', 'mcp_srv_write'))
      await tick()
      for (let i = 0; i < 29; i++) {
        await tick(10_000)
        f.send(call('a'))
        await tick()
      }
      await tick(10_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toMatchObject({
        cause: 'response_ceiling',
        elapsedMs: 300_000,
        budgetMs: 300_000
      })
      expect(f.execute).not.toHaveBeenCalled()
    })

    it('starts response clocks at dispatch and excludes a pre-request pause', async () => {
      const f = await setup(strategy, {
        preRequestDelayMs: 100_000,
        decisionResponseTimeoutMs: 20_000
      })
      await tick(99_000)
      expect(f.requests()).toBe(0)
      expect(f.errors).toEqual([])
      await tick(1_000)
      expect(f.requests()).toBe(1)
      f.send(call('{}', 'mcp_srv_write'))
      f.complete()
      await f.run
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.errors).toEqual([])
    })

    it('also bounds continuously streamed prose', async () => {
      const f = await setup(strategy, { decisionResponseTimeoutMs: 25_000 })
      f.send(delta({ content: 'Thinking' }))
      await tick()
      await tick(10_000)
      f.send(delta({ content: '.' }))
      await tick()
      await tick(10_000)
      f.send(delta({ content: '.' }))
      await tick()
      await tick(5_000)
      await f.run
      expect((f.errors[0] as RuntimeTimeoutError).diagnostics).toMatchObject({
        cause: 'response_ceiling',
        lastPhase: 'content',
        elapsedMs: 25_000
      })
    })

    it('cancels while waiting for the first meaningful response', async () => {
      const f = await setup(strategy)
      f.controller.abort()
      await f.run
      expect(f.signal()?.aborted).toBe(true)
      expect(f.errors).toEqual([])
      expect(f.execute).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('lets the registered schema reject complete JSON before execution', async () => {
      const f = await setup(strategy)
      f.send(call('{"value":5}', 'mcp_srv_write'))
      f.complete()
      await f.run
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.events.some((e) => e.type === 'agent.tool.failed')).toBe(true)
    })

    it('cancels a valid-but-unfinished call without execution or terminal telemetry', async () => {
      const f = await setup(strategy)
      f.send(call(`{"value":"${SECRET}"}`, 'mcp_srv_write'))
      await tick()
      f.controller.abort()
      await f.run
      expect(f.signal()?.aborted).toBe(true)
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.errors).toEqual([])
      expect(f.events.some((e) => e.type === 'error')).toBe(false)
      expect(f.cancel).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each([
      ['zero-argument', z.object({})],
      ['all-optional', z.object({ value: z.string().optional() })]
    ] as const)('accepts completed blank arguments for a %s tool', async (_label, schema) => {
      for (const args of ['', ' \n ']) {
        for (const terminal of [finish(), 'data: [DONE]\n\n']) {
          const f = await setup(strategy, { schema })
          f.send(call(args, 'mcp_srv_write'))
          await tick()
          expect(f.execute).not.toHaveBeenCalled()
          f.send(terminal)
          f.close()
          await f.run
          expect(f.execute).toHaveBeenCalledExactlyOnceWith({})
          expect(f.errors).toEqual([])
        }
      }
    })

    it('rejects blank arguments at the schema gate when a parameter is required', async () => {
      const f = await setup(strategy, { schema: z.object({ value: z.string() }) })
      f.send(call('', 'mcp_srv_write'))
      f.complete()
      await f.run
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.events.some((event) => event.type === 'agent.tool.failed')).toBe(true)
    })

    it('does not execute a name-only call without protocol completion', async () => {
      const f = await setup(strategy, { schema: z.object({}) })
      f.send(call('', 'mcp_srv_write'))
      f.close()
      await f.run
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.errors).toHaveLength(1)
    })

    it.each([
      ['malformed JSON', 'not-json', true, 'tool_calls'],
      ['truncated JSON', '{"value":', true, 'tool_calls'],
      ['array arguments', '[]', true, 'tool_calls'],
      ['null arguments', 'null', true, 'tool_calls'],
      ['transport EOF after valid JSON', '{}', false, 'tool_calls'],
      ['length finish after valid JSON', '{}', true, 'length'],
      ['filtered finish after valid JSON', '{}', true, 'content_filter']
    ])('rejects %s without tool side effects', async (_label, args, terminal, reason) => {
      const f = await setup(strategy)
      f.send(call(args, 'mcp_srv_write'))
      if (terminal) f.send(finish(reason) + 'data: [DONE]\n\n')
      f.close()
      await f.run
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.errors).toHaveLength(1)
      expect(f.errors[0]?.message).not.toContain(SECRET)
    })

    it.each(['', ': ping\n\n', delta({ role: 'assistant', content: '' })])(
      'rejects an empty/metadata-only completed stream',
      async (prefix) => {
        const f = await setup(strategy)
        f.send(prefix + 'data: [DONE]\n\n')
        f.close()
        await f.run
        expect(f.execute).not.toHaveBeenCalled()
        expect(f.errors).toHaveLength(1)
      }
    )

    it.each(['finish event', 'DONE marker'])(
      'accepts %s as protocol completion after valid JSON',
      async (terminal) => {
        const f = await setup(strategy)
        const frames = call('{}', 'mcp_srv_write')
        // Split an actual SSE frame across network reads, not just JSON argument deltas.
        f.send(frames.slice(0, 23))
        await tick()
        expect(f.execute).not.toHaveBeenCalled()
        f.send(frames.slice(23))
        await tick()
        expect(f.execute).not.toHaveBeenCalled()
        f.send(terminal === 'finish event' ? finish() : 'data: [DONE]\n\n')
        f.close()
        await f.run
        expect(f.execute).toHaveBeenCalledTimes(1)
        expect(f.errors).toEqual([])
      }
    )

    it('chooses the first indexed call once, with fragmented names and interleaved calls', async () => {
      const f = await setup(strategy)
      f.send(call('{"value":"second"}', 'mcp_srv_write', 1))
      f.send(call('{"value":', 'mcp_', 0))
      await tick()
      f.send(call('"first"}', 'srv_write', 0))
      f.complete()
      await f.run
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.execute.mock.calls[0]?.[0]).toEqual({ value: 'first' })
      expect(f.errors).toEqual([])
    })

    it('does not skip an incomplete first call to execute a later valid call', async () => {
      const f = await setup(strategy)
      f.send(call('{"value":', undefined, 0))
      f.send(call('{}', 'mcp_srv_write', 1))
      f.complete()
      await f.run
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.errors).toHaveLength(1)
    })

    it('does not replay a completed mutation when the next decision receives a 429', async () => {
      const f = await setup(strategy, { retryAfterAction: true })
      f.send(call('{}', 'mcp_srv_write'))
      f.complete()
      await tick()
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.requests()).toBe(2)
      await tick(2_000)
      await f.run
      expect(f.requests()).toBe(3)
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.errors).toEqual([])
      expect(f.events.some((e) => e.type === 'rate.limit.recovered')).toBe(true)
    })

    it('preserves short 429 backoff and retries before executing exactly once', async () => {
      const f = await setup(strategy, { retry: true })
      expect(f.requests()).toBe(1)
      await tick(999)
      expect(f.requests()).toBe(1)
      // Existing provider heuristic adds a small additional wait after runtime
      // cooldown. #533 owns removing that double wait, so preserve it here.
      await tick(1_001)
      expect(f.requests()).toBe(2)
      f.send(call('{}', 'mcp_srv_write'))
      f.complete()
      await f.run
      expect(f.execute).toHaveBeenCalledTimes(1)
      expect(f.errors).toEqual([])
      expect(f.events.some((e) => e.type === 'rate.limit.waiting')).toBe(true)
      expect(f.events.some((e) => e.type === 'rate.limit.recovered')).toBe(true)
    })
  })
}

// The host must explicitly forward diagnostic fields into Sentry contexts;
// passing a custom Error property alone does not guarantee SDK capture.
it('reports payload-safe timeout phase, elapsed time and model through the browser host', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller
    }
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(stream)))
  )
  const sink = vi.fn<CaptureExceptionSink>()
  setCaptureExceptionSink(sink)
  const runtime = createRuntime({
    baseUrl: 'https://edge.test',
    getToken: () => 'private-token',
    getModel: () => MODEL,
    agentType: 'react'
  })
  const run = (async () => {
    for await (const event of runtime.run('private-prompt')) {
      void event
    }
  })()
  await tick()
  body.enqueue(new TextEncoder().encode(call(`{"value":"${SECRET}`, 'private_tool_name')))
  await tick()
  await tick(15_000)
  await run
  const report = sink.mock.calls.find((args) => args[1]?.tags?.source === 'agent-runtime')
  expect(report?.[1]).toMatchObject({
    level: 'warning',
    tags: {
      reason: 'timeout',
      timeout_cause: 'argument_assembly',
      response_phase: 'tool_call',
      model: MODEL
    },
    contexts: {
      decision_timeout: {
        cause: 'argument_assembly',
        lastPhase: 'tool_call',
        elapsedMs: 15_000,
        budgetMs: 15_000,
        model: MODEL
      }
    }
  })
  for (const secret of [SECRET, 'private-token', 'private-prompt', 'private_tool_name']) {
    expect(JSON.stringify(report)).not.toContain(secret)
  }
})
