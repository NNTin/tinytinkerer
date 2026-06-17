import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'
import { isRateLimitError, type ExecutionContext } from '@tinytinkerer/app-core'
import { decideNextAction, streamDecision } from '../src/runtime/react-decider.js'
import type { PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import type { ModelsChatFetch } from '../src/runtime/edge-fetch.js'

const descriptor: PlannerToolDescriptor = {
  id: 'web-search',
  description: 'Search the web for fresh context.',
  inputSchema: { query: { type: 'string' } }
}

const baseContext = (overrides?: Partial<ExecutionContext>): ExecutionContext => ({
  prompt: 'What is the weather in Berlin?',
  history: [],
  plan: { complexity: 'low', steps: [] },
  notes: [],
  toolResults: {},
  ...overrides
})

const makeEdgeFetch = (responseBody: unknown, status = 200): ModelsChatFetch =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decideNextAction', () => {
  it('lists tool descriptors and accumulated observations in the request', async () => {
    const action = {
      kind: 'action',
      toolId: 'web-search',
      input: { query: 'Berlin weather' }
    }
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: JSON.stringify(action) } }]
    })

    await decideNextAction(
      baseContext({ notes: ['web-search: {"results":["r1"]}'] }),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(edgeFetch).toHaveBeenCalledOnce()
    const [init] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { model: string; stream: boolean; messages: Array<{ role: string; content: string }> }
    ]
    expect(init.model).toBe('openai/gpt-4.1-mini')
    expect(init.stream).toBe(false)
    const systemMsg = init.messages.find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('web-search')
    const userMsg = init.messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('Observations so far')
  })

  it('parses an action decision', async () => {
    const action = {
      kind: 'action',
      toolId: 'web-search',
      input: { query: 'Berlin weather' }
    }
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: JSON.stringify(action) } }]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('action')
    if (decision.kind !== 'action') {
      throw new Error('Expected an action decision')
    }
    expect(decision.toolId).toBe('web-search')
    expect(decision.input).toEqual({ query: 'Berlin weather' })
  })

  it('parses a final decision', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({ kind: 'final', reasoning: 'enough info' })
          }
        }
      ]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('final')
  })

  it('strips markdown code fences before parsing JSON', async () => {
    const fenced = '```json\n' + JSON.stringify({ kind: 'final' }) + '\n```'
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: fenced } }]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('final')
  })

  // The model is non-deterministic: it sometimes answers in prose, emits an
  // empty body, returns truncated/malformed JSON, or valid JSON of the wrong
  // shape. None of these should crash the run — they mean the model is done, so
  // we fall back to a `final` decision and let the loop synthesize the answer.
  it('falls back to a final decision when the model returns a non-decision shape', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: JSON.stringify({ kind: 'unknown' }) } }]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('final')
  })

  it('falls back to a final decision when the model answers in prose instead of JSON', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: 'I now have enough information to answer.' } }]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('final')
  })

  it('falls back to a final decision when the model emits truncated JSON', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: '{"kind":"action","toolId":"web-sea' } }]
    })

    const decision = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(decision.kind).toBe('final')
  })

  // Robust parsing: recover sloppy-but-COMPLETE decisions instead of needlessly
  // dropping to final (which loses the action). Truncated input is NOT repaired.
  it('recovers a complete decision wrapped in prose', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [
        {
          message: {
            content:
              'Sure! {"kind":"action","toolId":"web-search","input":{"query":"x"}} hope that helps'
          }
        }
      ]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    expect(decision.kind).toBe('action')
    if (decision.kind !== 'action') {
      throw new Error('Expected an action decision')
    }
    expect(decision.toolId).toBe('web-search')
  })

  it('recovers single-quoted JSON via lenient parsing', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: "{'kind':'final'}" } }]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    expect(decision.kind).toBe('final')
  })

  it('recovers JSON with a trailing comma', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: '{"kind":"final",}' } }]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    expect(decision.kind).toBe('final')
  })

  it('does NOT fabricate an action from truncated JSON — falls back to final', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [
        {
          message: {
            content: '{"kind":"action","toolId":"web-search","input":{"query":"Ber'
          }
        }
      ]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    // The truncated action must NOT be auto-completed into a runnable action with
    // a fabricated argument; we degrade to final instead.
    expect(decision.kind).toBe('final')
  })

  it('throws when the response is not ok', async () => {
    const edgeFetch = makeEdgeFetch({ error: 'Service Unavailable' }, 503)

    await expect(
      decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)
    ).rejects.toThrow('Service Unavailable')
  })

  it('throws the edge error body when the decision request is rejected upstream', async () => {
    const edgeFetch = makeEdgeFetch(
      {
        error: "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
      },
      400
    )

    await expect(
      decideNextAction(baseContext(), [descriptor], 'chatgpt/gpt-5.3-codex', edgeFetch)
    ).rejects.toThrow(
      "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('throws a RateLimitError on 429 so the runtime can wait and retry', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString()
    const edgeFetch = makeEdgeFetch(
      {
        code: 'rate_limited',
        error: 'Slow down',
        retryAfterMs: 30_000,
        retryAt
      },
      429
    )

    const error = await decideNextAction(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    ).catch((err: unknown) => err)

    expect(isRateLimitError(error)).toBe(true)
    if (!isRateLimitError(error)) {
      throw new Error('Expected a RateLimitError')
    }
    expect(error.retryAfterMs).toBe(30_000)
    expect(error.retryAt).toBe(retryAt)
  })
})

const makeSseEdgeFetch = (lines: string[], status = 200): ModelsChatFetch =>
  vi.fn().mockResolvedValue(
    new Response(lines.join('\n'), {
      status,
      headers: { 'content-type': 'text/event-stream' }
    })
  )

describe('streamDecision', () => {
  it('streams reasoning as growing thoughts then yields the parsed decision', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"kind\\":\\"final\\"}"}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(
      baseContext(),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )) {
      chunks.push(chunk)
    }

    const thoughts = chunks.filter((chunk) => chunk.kind === 'thought')
    expect(thoughts.at(-1)?.kind === 'thought' && thoughts.at(-1)?.text).toBe('Let me think')
    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('strips fences from the streamed JSON content', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"```json\\n"}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"kind\\":\\"final\\"}"}}]}',
      'data: {"choices":[{"delta":{"content":"\\n```"}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('parses the final SSE data line even without a trailing newline', async () => {
    const edgeFetch: ModelsChatFetch = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"{\\"kind\\":\\"final\\"}"}}]}', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('throws when the streaming response is not ok', async () => {
    const edgeFetch = makeSseEdgeFetch(['data: [DONE]'], 503)

    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    await expect(iterator.next()).rejects.toThrow('ReAct decision request failed (503)')
  })

  it('throws the edge error body when a streaming decision request is rejected upstream', async () => {
    const edgeFetch = makeEdgeFetch(
      {
        error: "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
      },
      400
    )

    const iterator = streamDecision(baseContext(), [descriptor], 'chatgpt/gpt-5.3-codex', edgeFetch)
    await expect(iterator.next()).rejects.toThrow(
      "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('throws when the streaming response has no body', async () => {
    const edgeFetch: ModelsChatFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    await expect(iterator.next()).rejects.toThrow('ReAct decision stream missing response body')
  })

  it('falls back to a final decision when the stream ends without decision JSON', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    expect(chunks.some((chunk) => chunk.kind === 'thought' && chunk.text === 'thinking')).toBe(true)
    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('falls back to a final decision when the model streams prose instead of JSON', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"I now have "}}]}',
      'data: {"choices":[{"delta":{"content":"enough info."}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('falls back to a final decision when the streamed JSON is truncated', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"{\\"kind\\":\\"action\\",\\"toolId\\":\\"web-sea"}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
  })

  it('throws a RateLimitError on 429 so the runtime can wait and retry', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString()
    const edgeFetch = makeEdgeFetch(
      {
        code: 'rate_limited',
        error: 'Slow down',
        retryAfterMs: 30_000,
        retryAt
      },
      429
    )

    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    const error = await iterator.next().catch((err: unknown) => err)

    expect(isRateLimitError(error)).toBe(true)
    if (!isRateLimitError(error)) {
      throw new Error('Expected a RateLimitError')
    }
    expect(error.retryAfterMs).toBe(30_000)
    expect(error.retryAt).toBe(retryAt)
  })
})

// Recovering to `final` keeps the user from seeing a crashed run, but a truncated
// decision means we abandoned the model's in-flight tool action and answered from
// incomplete tool results. That incompleteness is a real bug to surface, so the
// parse failure must STILL be captured — never suppressed via `accept`.
describe('streamDecision keeps non-conforming output visible (recover but stay loud)', () => {
  const sink = vi.fn<CaptureExceptionSink>()

  beforeEach(() => {
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('captures the parse_error on truncated decision JSON while still recovering to final', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"{\\"kind\\":\\"action\\",\\"toolId\\":\\"web-sea"}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')

    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] as [Error, { tags?: Record<string, unknown> }]
    expect(options.tags?.failure_kind).toBe('parse_error')
    expect(options.tags?.request_area).toBe('react.decide')
  })

  // A PURE-PROSE finish (no JSON value at all) is the model correctly deciding it
  // is done, not a defect — recover to final SILENTLY, without capturing. This is
  // the regression fix for FRONTEND-K: a prose finish must no longer generate
  // telemetry noise (which kept auto-regressing the issue).
  it('does NOT capture when the model finishes in prose (no JSON), but still recovers to final', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"I now have "}}]}',
      'data: {"choices":[{"delta":{"content":"enough information to answer."}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('final')
    expect(sink).not.toHaveBeenCalled()
  })

  it('does NOT capture a prose finish on the non-streaming decideNextAction path either', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: 'I now have enough information to answer.' } }]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    expect(decision.kind).toBe('final')
    expect(sink).not.toHaveBeenCalled()
  })
})
