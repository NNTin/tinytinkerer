import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isRateLimitError,
  type ExecutionContext,
  type ToolInvocation
} from '@tinytinkerer/app-core'
import type { ChatMessage } from '@tinytinkerer/contracts'
import { decideNextAction, streamDecision } from '../src/runtime/react-decider.js'
import type { PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import type { ModelsChatFetch } from '../src/runtime/edge-fetch.js'

const descriptor: PlannerToolDescriptor = {
  id: 'web-search',
  description: 'Search the web for fresh context.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
}

// An MCP-style tool id: contains `:`, which is NOT a legal OpenAI function name,
// so it must be sanitized for the wire and resolved back via the reversible map.
const mcpDescriptor: PlannerToolDescriptor = {
  id: 'mcp:srv:lookup',
  description: 'Look something up.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } }
}

const baseContext = (overrides?: Partial<ExecutionContext>): ExecutionContext => ({
  prompt: 'What is the weather in Berlin?',
  history: [],
  plan: { complexity: 'low', steps: [] },
  notes: [],
  toolResults: {},
  toolInvocations: [],
  ...overrides
})

const invocation = (
  overrides: Partial<ToolInvocation> & Pick<ToolInvocation, 'callId'>
): ToolInvocation => ({
  toolId: 'web-search',
  input: { query: 'Berlin weather' },
  outcome: { ok: true, output: { results: ['r1'] } },
  ...overrides
})

// A non-streaming response carrying a native tool call (the action), mirroring
// OpenAI's `choices[0].message.tool_calls` shape.
const toolCallResponse = (name: string, args: unknown) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }
        ]
      }
    }
  ]
})

const makeEdgeFetch = (responseBody: unknown, status = 200): ModelsChatFetch =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  )

const lastInit = (edgeFetch: ModelsChatFetch) => {
  const [init] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
    {
      model: string
      stream: boolean
      messages: ChatMessage[]
      tools?: Array<{ type: string; function: { name: string } }>
      tool_choice?: string
    }
  ]
  return init
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decideNextAction (native tool calling)', () => {
  it('advertises the tools and replays tool I/O as native messages — no prose notes', async () => {
    const edgeFetch = makeEdgeFetch(toolCallResponse('web-search', { query: 'Berlin weather' }))

    await decideNextAction(
      baseContext({
        toolInvocations: [
          invocation({ callId: 'call_prev', outcome: { ok: true, output: { results: ['r1'] } } })
        ]
      }),
      [descriptor],
      'openai/gpt-4.1-mini',
      edgeFetch
    )

    const init = lastInit(edgeFetch)
    expect(init.model).toBe('openai/gpt-4.1-mini')
    expect(init.stream).toBe(false)
    expect(init.tool_choice).toBe('auto')
    expect(init.tools?.map((t) => t.function.name)).toContain('web-search')

    // The prior tool call is replayed as a native assistant tool_calls turn + a
    // matching tool result turn, NOT as "Research notes:/Tool results:" prose.
    const assistantToolCall = init.messages.find(
      (m) => m.role === 'assistant' && 'tool_calls' in m && m.tool_calls
    )
    expect(assistantToolCall).toBeDefined()
    const toolResult = init.messages.find((m) => m.role === 'tool')
    expect(toolResult).toBeDefined()
    if (toolResult && 'tool_call_id' in toolResult) {
      expect(toolResult.tool_call_id).toBe('call_prev')
      expect(toolResult.content).toContain('r1')
    }
    const serialized = JSON.stringify(init.messages)
    expect(serialized).not.toContain('Research notes')
    expect(serialized).not.toContain('Tool results:')
  })

  it('parses an action decision from a native tool call', async () => {
    const edgeFetch = makeEdgeFetch(toolCallResponse('web-search', { query: 'Berlin weather' }))

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)

    expect(decision.kind).toBe('action')
    if (decision.kind !== 'action') throw new Error('Expected an action decision')
    expect(decision.toolId).toBe('web-search')
    expect(decision.input).toEqual({ query: 'Berlin weather' })
  })

  it('maps a sanitized wire function name back to the real (mcp:) tool id', async () => {
    // The model addresses the tool by its advertised, sanitized name; the decider
    // must resolve it back to the colon-bearing runtime id.
    const edgeFetch = makeEdgeFetch(toolCallResponse('mcp_srv_lookup', { q: 'x' }))

    const decision = await decideNextAction(baseContext(), [mcpDescriptor], 'm', edgeFetch)
    const init = lastInit(edgeFetch)
    // The colon-bearing id is advertised under a sanitized, OpenAI-legal name.
    expect(init.tools?.map((t) => t.function.name)).toEqual(['mcp_srv_lookup'])

    expect(decision.kind).toBe('action')
    if (decision.kind !== 'action') throw new Error('Expected an action decision')
    expect(decision.toolId).toBe('mcp:srv:lookup')
    expect(decision.input).toEqual({ q: 'x' })
  })

  it('returns a final decision when the model answers with content (no tool call)', async () => {
    const edgeFetch = makeEdgeFetch({
      choices: [{ message: { role: 'assistant', content: 'I can answer now.' } }]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)
    expect(decision.kind).toBe('final')
  })

  it('carries the model prose as the decision reasoning (so the timeline shows the "why")', async () => {
    // A non-reasoning model expresses its rationale as ordinary content alongside
    // the tool call; it must surface as the decision reasoning (issue #276).
    const edgeFetch = makeEdgeFetch({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I should search the web to answer this.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'web-search', arguments: '{"query":"x"}' }
              }
            ]
          }
        }
      ]
    })

    const decision = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)
    expect(decision.kind).toBe('action')
    expect(decision.reasoning).toBe('I should search the web to answer this.')
  })

  it('replays a multi-step (chained) tool history as ordered native turns', async () => {
    const edgeFetch = makeEdgeFetch(toolCallResponse('web-search', { query: 'follow-up' }))

    await decideNextAction(
      baseContext({
        toolInvocations: [
          invocation({
            callId: 'call_a',
            input: { query: 'first' },
            outcome: { ok: true, output: 1 }
          }),
          invocation({
            callId: 'call_b',
            input: { query: 'second' },
            outcome: { ok: false, error: 'boom' }
          })
        ]
      }),
      [descriptor],
      'm',
      edgeFetch
    )

    const init = lastInit(edgeFetch)
    const toolMessages = init.messages.filter((m) => m.role === 'tool')
    expect(toolMessages.map((m) => ('tool_call_id' in m ? m.tool_call_id : undefined))).toEqual([
      'call_a',
      'call_b'
    ])
    const assistantCalls = init.messages.filter(
      (m): m is Extract<ChatMessage, { role: 'assistant' }> =>
        m.role === 'assistant' && 'tool_calls' in m && Boolean(m.tool_calls)
    )
    expect(assistantCalls).toHaveLength(2)
    expect(assistantCalls[0]?.tool_calls?.[0]?.function.arguments).toBe(
      JSON.stringify({ query: 'first' })
    )
    // A failed tool still produces a tool result turn so every tool_call is answered.
    const failed = toolMessages.find((m) => 'tool_call_id' in m && m.tool_call_id === 'call_b')
    expect(failed && 'content' in failed && failed.content).toContain('boom')
  })

  it('throws when the response is not ok', async () => {
    const edgeFetch = makeEdgeFetch({ error: 'Service Unavailable' }, 503)
    await expect(decideNextAction(baseContext(), [descriptor], 'm', edgeFetch)).rejects.toThrow(
      'Service Unavailable'
    )
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
      { code: 'rate_limited', error: 'Slow down', retryAfterMs: 30_000, retryAt },
      429
    )

    const error = await decideNextAction(baseContext(), [descriptor], 'm', edgeFetch).catch(
      (err: unknown) => err
    )
    expect(isRateLimitError(error)).toBe(true)
    if (!isRateLimitError(error)) throw new Error('Expected a RateLimitError')
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

describe('streamDecision (native tool calling)', () => {
  it('streams reasoning as growing thoughts then yields an action from accumulated tool-call deltas', async () => {
    // The tool call's id/name arrive first, then its arguments accumulate across
    // two deltas — exercising the cross-delta accumulator.
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web-search","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"Ber"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lin\\"}"}}]}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const thoughts = chunks.filter((chunk) => chunk.kind === 'thought')
    expect(thoughts.at(-1)?.kind === 'thought' && thoughts.at(-1)?.text).toBe('Let me think')
    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('action')
    if (decision?.kind === 'decision' && decision.decision.kind === 'action') {
      expect(decision.decision.toolId).toBe('web-search')
      expect(decision.decision.input).toEqual({ query: 'Berlin' })
    }
  })

  it('streams plain content as the thought (non-reasoning models) before an action', async () => {
    // The model has no reasoning channel; its visible thinking is ordinary content
    // emitted before the tool call. It must surface as the growing thought so the
    // timeline is not blank (issue #276).
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"content":"I will "}}]}',
      'data: {"choices":[{"delta":{"content":"search."}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web-search","arguments":"{\\"query\\":\\"x\\"}"}}]}}]}',
      'data: [DONE]',
      ''
    ])

    const chunks = []
    for await (const chunk of streamDecision(baseContext(), [descriptor], 'm', edgeFetch)) {
      chunks.push(chunk)
    }

    const thoughts = chunks.filter((chunk) => chunk.kind === 'thought')
    expect(thoughts.at(-1)?.kind === 'thought' && thoughts.at(-1)?.text).toBe('I will search.')
    const decision = chunks.find((chunk) => chunk.kind === 'decision')
    expect(decision?.kind === 'decision' && decision.decision.kind).toBe('action')
  })

  it('yields a final decision when the stream carries no tool call', async () => {
    const edgeFetch = makeSseEdgeFetch([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
      'data: {"choices":[{"delta":{"content":"I now have enough info."}}]}',
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

  it('throws when the streaming response is not ok', async () => {
    const edgeFetch = makeSseEdgeFetch(['data: [DONE]'], 503)
    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    await expect(iterator.next()).rejects.toThrow('ReAct decision request failed (503)')
  })

  it('throws when the streaming response has no body', async () => {
    const edgeFetch: ModelsChatFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      )
    const iterator = streamDecision(baseContext(), [descriptor], 'm', edgeFetch)
    await expect(iterator.next()).rejects.toThrow('ReAct decision stream missing response body')
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
    if (!isRateLimitError(error)) throw new Error('Expected a RateLimitError')
    expect(error.retryAfterMs).toBe(30_000)
  })
})
