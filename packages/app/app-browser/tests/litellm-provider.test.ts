import { describe, expect, it, vi } from 'vitest'
import { RateLimitError, type ExecutionContext, type SynthesisChunk } from '@tinytinkerer/app-core'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'

vi.mock('../src/telemetry/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/telemetry/telemetry.js')>(
    '../src/telemetry/telemetry.js'
  )
  return {
    ...actual,
    getTelemetryHeaders: () => ({})
  }
})

import { LiteLLMProvider } from '../src/runtime/litellm-provider.js'
import { splitInlineThink } from '../src/runtime/sse-utils.js'

const telemetrySink = vi.fn<CaptureExceptionSink>()
setCaptureExceptionSink(telemetrySink)

async function* fromContentChunks(texts: string[]): AsyncGenerator<SynthesisChunk> {
  for (const text of texts) {
    await Promise.resolve()
    yield { kind: 'content', text }
  }
}

const drain = async (
  stream: AsyncIterable<SynthesisChunk>
): Promise<{ content: string; reasoning: string }> => {
  let content = ''
  let reasoning = ''
  for await (const chunk of stream) {
    if (chunk.kind === 'reasoning') {
      reasoning += chunk.text
    } else if (chunk.kind === 'content') {
      content += chunk.text
    }
  }
  return { content, reasoning }
}

const context: ExecutionContext = {
  prompt: 'hello',
  history: [],
  plan: { complexity: 'low', steps: [] },
  notes: [],
  toolResults: {},
  toolInvocations: []
}

const collect = async (stream: AsyncIterable<SynthesisChunk>): Promise<string> => {
  let output = ''
  for await (const chunk of stream) {
    if (chunk.kind === 'content') {
      output += chunk.text
    }
  }
  return output
}

describe('LiteLLMProvider', () => {
  it.each(['', ' \n '])(
    'preserves completed non-streaming blank tool arguments: %j',
    async (args) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      tool_calls: [
                        {
                          id: 'call_status',
                          type: 'function',
                          function: { name: 'status', arguments: args }
                        }
                      ]
                    }
                  }
                ]
              }),
              { headers: { 'content-type': 'application/json' } }
            )
          )
        )
      )
      try {
        const provider = new LiteLLMProvider({
          baseUrl: 'https://edge.test',
          allToolDescriptors: [
            { id: 'status', description: 'Status', inputSchema: { type: 'object', properties: {} } }
          ]
        })
        await expect(provider.decideNextAction(context)).resolves.toMatchObject({
          kind: 'action',
          toolId: 'status',
          input: {}
        })
      } finally {
        vi.unstubAllGlobals()
      }
    }
  )

  it.each(['length', 'content_filter'])(
    'rejects a non-streaming blank call after %s',
    async (reason) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: reason,
                    message: {
                      tool_calls: [
                        {
                          id: 'call_status',
                          type: 'function',
                          function: { name: 'status', arguments: '' }
                        }
                      ]
                    }
                  }
                ]
              }),
              { headers: { 'content-type': 'application/json' } }
            )
          )
        )
      )
      try {
        const provider = new LiteLLMProvider({ baseUrl: 'https://edge.test' })
        await expect(provider.decideNextAction(context)).rejects.toThrow(
          'without a complete response'
        )
      } finally {
        vi.unstubAllGlobals()
      }
    }
  )

  it('returns a low-complexity plan for a plain prompt', async () => {
    const provider = new LiteLLMProvider({ baseUrl: 'http://example.com' })
    const plan = await provider.plan('tell me a joke', [])
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((step) => step.id)).toEqual(['understand', 'compose'])
  })

  it('proposes a heuristic search step from the web-search descriptor when the LLM planner is unavailable', async () => {
    // With a tool present the provider tries the LLM planner first; here the network
    // fails, so it falls through to the heuristic inferPlan. The web-search keyword
    // step now travels on the descriptor (keywordPlannerStep), so the provider
    // proposes it without the host naming the tool id itself.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      allToolDescriptors: [
        {
          id: 'web-search',
          description: 'Search the web',
          inputSchema: {},
          keywordPlannerStep: {
            keywords: ['latest', 'news', 'today'],
            stepId: 'search',
            summary: 'Collect current references from web search',
            inputTemplate: { query: '{{prompt}}', maxResults: 5 }
          }
        }
      ]
    })
    const plan = await provider.plan('what is the latest news today?', [])
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.map((step) => step.id)).toEqual(['understand', 'search', 'compose'])
    expect(plan.steps[1]?.toolCall?.toolId).toBe('web-search')
    expect(plan.steps[1]?.toolCall?.input).toEqual({
      query: 'what is the latest news today?',
      maxResults: 5
    })
    vi.unstubAllGlobals()
  })

  it('throws a typed rate limit error for 429 responses', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'rate_limited',
              error: 'rate limited',
              retryAfterMs: 120_000,
              retryAt
            }),
            {
              status: 429,
              headers: { 'retry-after': '120' }
            }
          )
        )
      )
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    // The error carries the one effective deadline the runtime waits out: the
    // upstream window amplified by 1.1 plus jitter (issue #533).
    const error = (await collect(provider.synthesize(context)).catch(
      (e: unknown) => e
    )) as RateLimitError
    expect(error.name).toBe('RateLimitError')
    expect(error.retryAfterMs).toBeGreaterThanOrEqual(132_050)
    expect(error.retryAfterMs).toBeLessThanOrEqual(132_301)
    expect(Date.parse(error.retryAt)).toBeGreaterThan(Date.parse(retryAt))

    vi.unstubAllGlobals()
  })

  it('accepts the synthesize 429 window-opener without capturing it (TINYTINKERER-FRONTEND-B)', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'rate_limited',
              error: 'rate limited',
              retryAfterMs: 120_000,
              retryAt
            }),
            { status: 429, headers: { 'retry-after': '120', 'content-type': 'application/json' } }
          )
        )
      )
    )
    telemetrySink.mockClear()

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    // SYNTHESIZE is the sibling call site to DECIDE; its 429 opens the durable
    // backoff window and surfaces as a RateLimitError cooldown — it must NOT be
    // captured as an http_error (that was TINYTINKERER-FRONTEND-B).
    await expect(collect(provider.synthesize(context))).rejects.toMatchObject({
      name: 'RateLimitError'
    } satisfies Partial<RateLimitError>)

    const capturedChat429 = telemetrySink.mock.calls.some(
      ([, options]) =>
        options?.tags?.['request_area'] === 'models.chat' &&
        options?.tags?.['failure_kind'] === 'http_error'
    )
    expect(capturedChat429).toBe(false)

    vi.unstubAllGlobals()
  })

  it('includes prior conversation turns before the current prompt', async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      void _input
      void init
      const body = ['data: {"choices":[{"delta":{"content":"ok"}}]}', '', 'data: [DONE]', ''].join(
        '\n'
      )
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token',
      allToolDescriptors: [
        { id: 'search', description: 'Search stored data', inputSchema: { type: 'object' } }
      ]
    })

    const output = await collect(
      provider.synthesize({
        ...context,
        prompt: 'Do you know my name?',
        history: [
          { role: 'user', content: 'hello, my name is Tin' },
          { role: 'assistant', content: 'Hello Tin! How can I assist you today?' }
        ],
        toolInvocations: [
          {
            callId: 'call_search_1',
            toolId: 'search',
            input: { query: 'name' },
            outcome: { ok: true, output: { result: 'Tin' } }
          }
        ]
      })
    )

    expect(output).toBe('ok')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const firstCall = fetchSpy.mock.calls[0]
    if (!firstCall) {
      throw new Error('Expected fetch to be called once')
    }

    const [, init] = firstCall
    if (typeof init?.body !== 'string') {
      throw new Error('Expected fetch body to be a JSON string')
    }

    const requestBody = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string | null; tool_call_id?: string }>
      tool_choice?: string
    }

    // Native tool calling (issue #276): the tool I/O is replayed as an assistant
    // tool_calls turn + a tool result turn — NOT folded into the user prompt as
    // "Research notes:/Tool results:" prose. Synthesis forbids new tool calls.
    expect(requestBody.tool_choice).toBe('none')
    expect(requestBody.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'hello, my name is Tin' },
      { role: 'assistant', content: 'Hello Tin! How can I assist you today?' },
      { role: 'user', content: 'Do you know my name?' },
      expect.objectContaining({
        role: 'assistant',
        content: null,
        tool_calls: [
          expect.objectContaining({
            id: 'call_search_1',
            type: 'function',
            function: { name: 'search', arguments: JSON.stringify({ query: 'name' }) }
          })
        ]
      }),
      { role: 'tool', tool_call_id: 'call_search_1', content: JSON.stringify({ result: 'Tin' }) }
    ])
    const serialized = JSON.stringify(requestBody.messages)
    expect(serialized).not.toContain('Research notes')
    expect(serialized).not.toContain('Tool results:')

    vi.unstubAllGlobals()
  })

  it('surfaces an error (does not degrade to a guessed plan) and emits telemetry for invalid planning JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'not valid json' } }]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        )
      )
    )
    telemetrySink.mockClear()

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token',
      allToolDescriptors: [{ id: 'mcp:test:lookup', description: 'lookup', inputSchema: {} }]
    })

    // A wrong/guessed plan is worse than a clear failure, so the planner must
    // surface the parse failure to the run-error path rather than silently
    // degrading to the heuristic inferPlan (issue #139).
    await expect(provider.plan('Tell me something about this repo', [])).rejects.toMatchObject({
      name: 'ModelJsonError',
      kind: 'parse_error'
    })

    // It still stays loud: the parse_error is captured before the throw.
    expect(telemetrySink).toHaveBeenCalledTimes(1)
    const [, options] = telemetrySink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'planning.chat',
      failure_kind: 'parse_error'
    })

    vi.unstubAllGlobals()
  })

  it('rethrows typed rate limit errors from LLM planning', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'rate_limited',
              error: 'planner rate limited',
              retryAfterMs: 120_000,
              retryAt
            }),
            {
              status: 429,
              headers: { 'retry-after': '120', 'content-type': 'application/json' }
            }
          )
        )
      )
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token',
      allToolDescriptors: [{ id: 'mcp:test:lookup', description: 'lookup', inputSchema: {} }]
    })

    await expect(provider.plan('Tell me something about this repo', [])).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfterMs: 120_000,
      retryAt
    } satisfies Partial<RateLimitError>)

    vi.unstubAllGlobals()
  })

  it('backs off the ReAct decision path after a 429 instead of retry-spamming (TINYTINKERER-FRONTEND-9)', async () => {
    vi.useFakeTimers()
    const rateLimited = () =>
      new Response(
        JSON.stringify({
          code: 'rate_limited',
          error: 'rate limited',
          retryAfterMs: 120_000,
          retryAt: new Date(Date.now() + 120_000).toISOString()
        }),
        { status: 429, headers: { 'retry-after': '120', 'content-type': 'application/json' } }
      )
    const fetchSpy = vi.fn(() => Promise.resolve(rateLimited()))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = new LiteLLMProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    // First decision reaches the edge, gets a 429, and records the backoff.
    await expect(provider.decideNextAction(context)).rejects.toMatchObject({
      name: 'RateLimitError'
    } satisfies Partial<RateLimitError>)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // The second decision raises the recorded backoff as a pre-request cooldown
    // (issue #533) instead of sleeping inside the timed call or re-hitting the
    // rate-limited endpoint.
    const cooldown = (await provider
      .decideNextAction(context)
      .catch((e: unknown) => e)) as RateLimitError
    expect(cooldown).toMatchObject({
      name: 'RateLimitError',
      message: 'Waiting out the model rate limit'
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Once that one deadline passes the next decision dispatches immediately.
    vi.setSystemTime(Date.parse(cooldown.retryAt))
    await expect(provider.decideNextAction(context)).rejects.toMatchObject({
      name: 'RateLimitError'
    } satisfies Partial<RateLimitError>)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})

describe('splitInlineThink', () => {
  it('routes inline <think>…</think> content to the reasoning channel', async () => {
    const result = await drain(
      splitInlineThink(fromContentChunks(['<think>reasoning here</think>final answer']))
    )
    expect(result.reasoning).toBe('reasoning here')
    expect(result.content).toBe('final answer')
  })

  it('handles think tags split across chunk boundaries', async () => {
    const result = await drain(
      splitInlineThink(fromContentChunks(['<th', 'ink>reason', 'ing</thi', 'nk>ans', 'wer']))
    )
    expect(result.reasoning).toBe('reasoning')
    expect(result.content).toBe('answer')
  })

  it('passes through content untouched when there is no think block', async () => {
    const result = await drain(splitInlineThink(fromContentChunks(['just ', 'an answer'])))
    expect(result.reasoning).toBe('')
    expect(result.content).toBe('just an answer')
  })

  it('preserves separate reasoning chunks emitted by the provider', async () => {
    async function* mixed(): AsyncGenerator<SynthesisChunk> {
      await Promise.resolve()
      yield { kind: 'reasoning', text: 'native reasoning' }
      yield { kind: 'content', text: 'answer' }
    }
    const result = await drain(splitInlineThink(mixed()))
    expect(result.reasoning).toBe('native reasoning')
    expect(result.content).toBe('answer')
  })
})
