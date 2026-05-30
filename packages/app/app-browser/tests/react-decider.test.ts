import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@tinytinkerer/app-core'
import { decideNextAction } from '../src/runtime/react-decider.js'
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
})
