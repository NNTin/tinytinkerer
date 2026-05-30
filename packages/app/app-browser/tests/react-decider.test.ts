import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRateLimitError, type ExecutionContext } from '@tinytinkerer/app-core'
import { decideNextAction, streamDecision } from '../src/runtime/react-decider.js'
import type { PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import type { EdgeFetch } from '../src/runtime/edge-fetch.js'

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

const makeEdgeFetch = (responseBody: unknown, status = 200): EdgeFetch =>
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
    const action = { kind: 'action', toolId: 'web-search', input: { query: 'Berlin weather' } }
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(action) } }] })

    await decideNextAction(
      baseContext({ notes: ['web-search: {"results":["r1"]}'] }),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    expect(edgeFetch).toHaveBeenCalledOnce()
    const [path, body] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { model: string; messages: Array<{ role: string; content: string }> }
    ]
    expect(path).toBe('/api/models/chat')
    const systemMsg = body.messages.find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('web-search')
    const userMsg = body.messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('Observations so far')
  })

  it('parses an action decision', async () => {
    const action = { kind: 'action', toolId: 'web-search', input: { query: 'Berlin weather' } }
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(action) } }] })

    const decision = await decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(decision.kind).toBe('action')
    if (decision.kind !== 'action') {
      throw new Error('Expected an action decision')
    }
    expect(decision.toolId).toBe('web-search')
    expect(decision.input).toEqual({ query: 'Berlin weather' })
  })

  it('parses a final decision', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: JSON.stringify({ kind: 'final', reasoning: 'enough info' }) } }]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(decision.kind).toBe('final')
  })

  it('strips markdown code fences before parsing JSON', async () => {
    const fenced = '```json\n' + JSON.stringify({ kind: 'final' }) + '\n```'
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: fenced } }] })

    const decision = await decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(decision.kind).toBe('final')
  })

  it('throws when the model returns a non-decision shape', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { content: JSON.stringify({ kind: 'unknown' }) } }]
    })

    await expect(
      decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)
    ).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    const edgeFetch = makeEdgeFetch({ error: 'Service Unavailable' }, 503)

    await expect(
      decideNextAction(baseContext(), [descriptor], 'openai/gpt-4.1-mini', edgeFetch)
    ).rejects.toThrow('ReAct decision request failed (503)')
  })

  it('throws a RateLimitError on 429 so the runtime can wait and retry', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString()
    const edgeFetch = makeEdgeFetch(
      { code: 'rate_limited', error: 'Slow down', retryAfterMs: 30_000, retryAt },
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

const makeSseEdgeFetch = (lines: string[], status = 200): EdgeFetch =>
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

  it('throws when the streaming response is not ok', async () => {
    const edgeFetch = makeSseEdgeFetch(['data: [DONE]'], 503)

    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    await expect(iterator.next()).rejects.toThrow('ReAct decision request failed (503)')
  })

  it('throws a RateLimitError on 429 so the runtime can wait and retry', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString()
    const edgeFetch = makeEdgeFetch(
      { code: 'rate_limited', error: 'Slow down', retryAfterMs: 30_000, retryAt },
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
