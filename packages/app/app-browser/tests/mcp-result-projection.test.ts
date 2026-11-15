import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ToolInvocation, Tool } from '@tinytinkerer/app-core'
import {
  type ChatEvent,
  buildMcpCallResponse,
  clampChatMessageContent,
  EDGE_ROUTE_PATHS,
  MAX_CHAT_MESSAGE_CONTENT_CHARS,
  mcpCallResponseSchema,
  type McpCallRequest,
  type McpDiscoveryResult,
  type McpServerConfig
} from '@tinytinkerer/contracts'
import { createRuntime } from '../src/runtime/create-runtime.js'
import { decideNextAction } from '../src/runtime/react-decider.js'
import type { ModelsChatFetch } from '../src/runtime/edge-fetch.js'
import { buildToolNameMap, toolInvocationsToMessages } from '../src/runtime/tool-calling.js'

// Issue #532: the model sees an MCP result's text once. The edge envelope's
// `text` is an alias of `raw.content`'s text blocks, so the model-facing
// projection drops it — and only it — while the run's own record (activity
// events, the app policy's results) keeps the full envelope.
//
// The MCP half of the network answers with the edge's own envelope producer
// (`buildMcpCallResponse`, which the `/api/mcp/call` route returns), validated
// by the same schema the edge parses through; the model half records every
// `/api/models/chat` body the runtime actually sends.

const SERVER: McpServerConfig = {
  id: 'kiprint',
  name: 'KiPrint',
  url: 'https://kiprint.test/mcp',
  enabled: true
}

type CallToolResult = { content?: unknown[]; structuredContent?: unknown; isError?: boolean }

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1
const bytes = (value: string): number => new TextEncoder().encode(value).length

// A guide-sized KiPrint result (a WireGuideDesign-like JSON document, served as
// JSON text the way `plan_guide` does) carrying a unique marker exactly once,
// with quotes, newlines and non-ASCII text that JSON escaping has to handle.
// 100 channels is ~24k chars (~27k once escaped into a tool message): it fits
// the 32k per-message ceiling once, but not twice.
const guideText = (marker: string, channels: number): string =>
  JSON.stringify(
    {
      marker,
      board: { partId: 'stripboard-30x20', cols: 30, rows: 20 },
      channels: Array.from({ length: channels }, (_, index) => ({
        id: `ch-${index}`,
        net: `NET_${index % 17}`,
        path: [
          [index % 30, index % 20],
          [(index + 3) % 30, (index + 5) % 20]
        ],
        note: `Route "${index}" under R${index % 9}\nkeep 2 mm ⌀ clearance`
      }))
    },
    null,
    2
  )

const harness = (options: {
  results: Record<string, CallToolResult | 'transport-error'>
  calls: { tool: string; args?: Record<string, unknown> }[]
  appTools?: Tool<unknown, unknown>[]
}) => {
  const decisions: string[] = []
  const syntheses: string[] = []
  const policyResults: unknown[] = []
  let next = 0

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '{}'
    if (url.endsWith(EDGE_ROUTE_PATHS.mcpCall)) {
      const request = JSON.parse(body) as McpCallRequest
      const result = options.results[request.toolName]
      if (!result || result === 'transport-error') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'MCP call failed' }), { status: 502 })
        )
      }
      const envelope = mcpCallResponseSchema.parse(
        buildMcpCallResponse(SERVER.name, request.toolName, result)
      )
      return Promise.resolve(new Response(JSON.stringify(envelope), { status: 200 }))
    }

    const request = JSON.parse(body) as {
      tool_choice?: string
      tools?: { function: { name: string } }[]
    }
    if (request.tool_choice === 'none') {
      syntheses.push(body)
      return Promise.resolve(new Response(sse({ delta: { content: 'Done.' } }), { status: 200 }))
    }
    decisions.push(body)
    const call = options.calls[next]
    next += 1
    if (!call) {
      return Promise.resolve(new Response(sse({ delta: { content: 'Ready.' } }), { status: 200 }))
    }
    const wireName = request.tools
      ?.map((tool) => tool.function.name)
      .find((name) => name === call.tool || name.endsWith(`_${call.tool}`))
    if (!wireName) throw new Error(`tool ${call.tool} was not advertised`)
    return Promise.resolve(
      new Response(
        sse({
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call-${next}`,
                function: { name: wireName, arguments: JSON.stringify(call.args ?? {}) }
              }
            ]
          }
        }),
        { status: 200 }
      )
    )
  })

  const discovery: Record<string, McpDiscoveryResult> = {
    [SERVER.id]: {
      serverId: SERVER.id,
      serverName: SERVER.name,
      syncedAt: '2026-11-15T00:00:00.000Z',
      tools: Object.keys(options.results).map((toolName) => ({
        toolName,
        description: `KiPrint ${toolName}`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: true }
      }))
    }
  }

  const runtime = createRuntime({
    baseUrl: '',
    getToken: () => 'token',
    getModel: () => 'openai/gpt-4.1-mini',
    agentType: 'react',
    mcpServers: [SERVER],
    mcpDiscovery: discovery,
    appAssistantPolicy: {
      finalizeAnswer: ({ source, results }) => {
        policyResults.push(...results)
        return source
      }
    },
    ...(options.appTools
      ? { appToolGroup: { id: 'canfactory', label: 'CanFactory', tools: options.appTools } }
      : {})
  })

  const run = async () => {
    const events: ChatEvent[] = []
    for await (const event of runtime.run('Plan the wire guide.')) events.push(event)
    return events
  }

  return { decisions, syntheses, policyResults, run }
}

function sse(choice: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [choice] })}\n\ndata: [DONE]\n\n`
}

type WireMessage = { role: string; content: string | null; tool_call_id?: string }
const toolMessages = (body: string): WireMessage[] =>
  (JSON.parse(body) as { messages: WireMessage[] }).messages.filter(
    (message) => message.role === 'tool'
  )
const toolContents = (body: string): unknown[] =>
  toolMessages(body).map((message): unknown =>
    message.content?.startsWith('Error: ') ? message.content : JSON.parse(message.content ?? '')
  )

// The run's own record of each completed tool call: what the activity panel
// renders and the inspector/a checkpoint would keep.
const completedOutputs = (events: ChatEvent[]) =>
  events.flatMap((event) =>
    event.type === 'agent.tool.completed'
      ? [event.payload as { stepId: string; toolId: string; output: unknown; source?: unknown }]
      : []
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MCP model-facing projection (issue #532)', () => {
  it('sends a large text-only guide once, while the run keeps the full envelope', async () => {
    const marker = `GUIDE-MARKER-532-${crypto.randomUUID()}`
    const text = guideText(marker, 100)
    const raw = { content: [{ type: 'text', text }] }
    const test = harness({ results: { plan_guide: raw }, calls: [{ tool: 'plan_guide' }] })

    const events = await test.run()

    // The decision after the call and the synthesis each carry the payload
    // once, whole: it parses, so the per-message ceiling did not cut it.
    expect(test.decisions).toHaveLength(2)
    const next = test.decisions[1]!
    for (const body of [next, test.syntheses[0]!]) {
      expect(occurrences(body, marker)).toBe(1)
      expect(body).not.toContain('[truncated')
      expect(toolContents(body)).toEqual([
        { serverName: 'KiPrint', toolName: 'plan_guide', raw, isError: false }
      ])
    }

    // The full edge envelope, alias included, is what the run recorded and what
    // the host's policy (CanFactory's pass-through, #170) receives.
    const envelope = buildMcpCallResponse('KiPrint', 'plan_guide', raw)
    expect(envelope.text).toBe(text)
    expect(completedOutputs(events)).toEqual([
      expect.objectContaining({
        toolId: 'mcp:kiprint:plan_guide',
        output: envelope,
        source: { kind: 'mcp', groupId: 'kiprint' }
      })
    ])
    expect(test.policyResults).toEqual([
      {
        toolId: 'mcp:kiprint:plan_guide',
        output: envelope,
        source: { kind: 'mcp', groupId: 'kiprint' }
      }
    ])

    // Before #532 the same tool message was the whole envelope, clamped by the
    // same ceiling: the guide twice, and the second copy cut short.
    const legacy = next.replace(
      JSON.stringify(toolMessages(next)[0]!.content),
      JSON.stringify(clampChatMessageContent(JSON.stringify(envelope)))
    )
    expect(occurrences(legacy, marker)).toBe(2)
    expect(legacy).toContain('[truncated')
    expect(bytes(next)).toBeLessThan(bytes(legacy))
  })

  it('halves the replayed bytes of a guide that fits twice', async () => {
    const marker = `GUIDE-MARKER-532-${crypto.randomUUID()}`
    const raw = { content: [{ type: 'text', text: guideText(marker, 50) }] }
    const test = harness({ results: { plan_guide: raw }, calls: [{ tool: 'plan_guide' }] })
    await test.run()

    const next = test.decisions[1]!
    const content = toolMessages(next)[0]!.content!
    const legacyContent = JSON.stringify(buildMcpCallResponse('KiPrint', 'plan_guide', raw))
    expect(legacyContent.length).toBeLessThan(MAX_CHAT_MESSAGE_CONTENT_CHARS)
    const legacy = next.replace(JSON.stringify(content), JSON.stringify(legacyContent))
    expect(occurrences(legacy, marker)).toBe(2)
    // The saving is the alias itself: one escaped copy of the guide text.
    const aliasBytes = bytes(JSON.stringify(JSON.stringify(raw.content[0]!.text)))
    expect(bytes(legacy) - bytes(next)).toBeGreaterThanOrEqual(aliasBytes - 2)
    expect(bytes(JSON.stringify(content))).toBeLessThan(bytes(JSON.stringify(legacyContent)) * 0.55)
  })

  it('keeps each payload single across a multi-step guide workflow', async () => {
    const guideMarker = `GUIDE-${crypto.randomUUID()}`
    const footprintMarker = `FOOTPRINT-${crypto.randomUUID()}`
    const test = harness({
      results: {
        get_footprint: {
          content: [{ type: 'text', text: `{"footprint":"${footprintMarker}","pads":[1,2]}` }]
        },
        plan_guide: { content: [{ type: 'text', text: guideText(guideMarker, 100) }] },
        check_project: { content: [{ type: 'text', text: '{"ok":true,"issues":[]}' }] }
      },
      calls: [{ tool: 'get_footprint' }, { tool: 'plan_guide' }, { tool: 'check_project' }]
    })

    await test.run()

    expect(test.decisions).toHaveLength(4)
    // Every later decision replays all earlier results; none reintroduces the
    // alias, and each payload stays at one copy however often it is replayed.
    test.decisions.slice(1).forEach((body, index) => {
      expect(toolMessages(body)).toHaveLength(index + 1)
      expect(occurrences(body, footprintMarker)).toBe(1)
      expect(occurrences(body, guideMarker)).toBe(index >= 1 ? 1 : 0)
      for (const content of toolContents(body)) {
        expect(content).not.toHaveProperty('text')
      }
    })
    expect(occurrences(test.syntheses[0]!, guideMarker)).toBe(1)
    expect(occurrences(test.syntheses[0]!, footprintMarker)).toBe(1)
  })

  it('preserves ordered and escaped text blocks, structured and mixed content, media and errors', async () => {
    const multi = {
      content: [
        { type: 'text', text: '{"step":1,"quote":"say \\"hi\\""}' },
        { type: 'text', text: 'second\nblock\twith "quotes" and ⚡' }
      ]
    }
    // A server that also serializes its structuredContent into a text block:
    // the two are distinct MCP fields and both stay.
    const structured = {
      content: [{ type: 'text', text: '{"ok":true}' }],
      structuredContent: { ok: true }
    }
    const media = {
      content: [
        { type: 'text', text: 'Rendered preview.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        { type: 'resource_link', uri: 'kiprint://projects/p1/guide.svg', name: 'guide.svg' }
      ]
    }
    const failed = { content: [{ type: 'text', text: 'unknown projectId' }], isError: true }
    const test = harness({
      results: {
        multi_text: multi,
        structured,
        render: media,
        failing: failed,
        unreachable: 'transport-error'
      },
      calls: [
        { tool: 'multi_text' },
        { tool: 'structured' },
        { tool: 'render' },
        { tool: 'failing' },
        { tool: 'unreachable' }
      ]
    })

    const events = await test.run()

    const final = test.decisions.at(-1)!
    expect(toolContents(final)).toEqual([
      { serverName: 'KiPrint', toolName: 'multi_text', raw: multi, isError: false },
      { serverName: 'KiPrint', toolName: 'structured', raw: structured, isError: false },
      { serverName: 'KiPrint', toolName: 'render', raw: media, isError: false },
      { serverName: 'KiPrint', toolName: 'failing', raw: failed, isError: true },
      'Error: MCP call failed'
    ])
    expect(toolContents(test.syntheses[0]!)).toEqual(toolContents(final))
    // The recorded outputs are still the complete envelopes.
    expect(completedOutputs(events).map((completed) => completed.output)).toEqual([
      buildMcpCallResponse('KiPrint', 'multi_text', multi),
      buildMcpCallResponse('KiPrint', 'structured', structured),
      buildMcpCallResponse('KiPrint', 'render', media),
      buildMcpCallResponse('KiPrint', 'failing', failed)
    ])
  })

  it('leaves app-tool outputs intact, including envelope lookalikes and media refs', async () => {
    const lookalikeText = `APP-${crypto.randomUUID()}`
    // Shaped exactly like an MCP envelope, but an app tool: shape is not origin.
    const lookalike = {
      serverName: 'KiPrint',
      toolName: 'plan_guide',
      text: lookalikeText,
      raw: { content: [{ type: 'text', text: lookalikeText }] },
      isError: false
    }
    const appTool = (id: string, output: unknown): Tool<unknown, unknown> => ({
      id,
      description: id,
      schema: z.object({}),
      execute: () => Promise.resolve(output)
    })
    const snapshot = {
      caption: 'Stage',
      media: [
        {
          kind: 'image',
          dataUrl: 'data:image/png;base64,QUJD',
          mimeType: 'image/png',
          width: 4,
          height: 3,
          description: 'The stage'
        }
      ]
    }
    const test = harness({
      results: {},
      calls: [{ tool: 'mcp_kiprint_plan_guide' }, { tool: 'note' }, { tool: 'snapshot' }],
      appTools: [
        appTool('mcp_kiprint_plan_guide', lookalike),
        appTool('note', { text: 'hello', body: 'hello' }),
        appTool('snapshot', snapshot)
      ]
    })

    await test.run()

    const final = test.decisions.at(-1)!
    const [first, second, third] = toolContents(final)
    expect(first).toEqual(lookalike)
    expect(occurrences(final, lookalikeText)).toBe(2)
    expect(second).toEqual({ text: 'hello', body: 'hello' })
    expect(third).toEqual({
      caption: 'Stage',
      media: [
        {
          mediaRef: `media:${toolMessages(final)[2]!.tool_call_id}#0`,
          description: 'The stage',
          width: 4,
          height: 3,
          mimeType: 'image/png'
        }
      ]
    })
    expect(final).not.toContain('QUJD')
  })

  it('re-derives the same projection from restored history on the non-streaming path', async () => {
    const marker = `RESTORED-${crypto.randomUUID()}`
    const test = harness({
      results: { plan_guide: { content: [{ type: 'text', text: guideText(marker, 50) }] } },
      calls: [{ tool: 'plan_guide' }]
    })
    const events = await test.run()

    // Rebuild the run's invocations from its recorded activity alone, through a
    // JSON round trip — what a stored conversation or checkpoint would hold.
    const started = new Map(
      events.flatMap((event) =>
        event.type === 'agent.tool.started'
          ? [[event.payload.stepId, event.payload.input] as const]
          : []
      )
    )
    const restored = JSON.parse(
      JSON.stringify(
        completedOutputs(events).map(
          (completed): ToolInvocation => ({
            callId: completed.stepId,
            toolId: completed.toolId,
            input: started.get(completed.stepId) ?? {},
            outcome: { ok: true, output: completed.output },
            ...(completed.source
              ? { source: completed.source as NonNullable<ToolInvocation['source']> }
              : {})
          })
        )
      )
    ) as ToolInvocation[]

    const modelsChat = vi.fn<ModelsChatFetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Ready.' } }] }), {
          status: 200
        })
      )
    )
    await decideNextAction(
      {
        prompt: 'Plan the wire guide.',
        history: [],
        plan: { complexity: 'low', steps: [] },
        notes: [],
        toolResults: {},
        toolInvocations: restored
      },
      [{ id: 'mcp:kiprint:plan_guide', description: 'KiPrint plan_guide', inputSchema: {} }],
      'm',
      modelsChat
    )
    const body = JSON.stringify(modelsChat.mock.calls[0]![0])

    expect(occurrences(body, marker)).toBe(1)
    // Same tool message the streamed decision and the synthesis sent.
    expect(toolMessages(body)).toEqual(toolMessages(test.decisions[1]!))
    expect(toolMessages(body)).toEqual(toolMessages(test.syntheses[0]!))
  })
})

describe('modelFacingToolOutput provenance (issue #532)', () => {
  const raw = { content: [{ type: 'text', text: 'payload' }] }
  const envelope = buildMcpCallResponse('KiPrint', 'plan_guide', raw)
  const toWire = buildToolNameMap([]).toWire
  const send = (invocation: Partial<ToolInvocation>, output: unknown = envelope) =>
    JSON.parse(
      toolInvocationsToMessages(
        [
          {
            callId: 'c1',
            toolId: 'mcp:kiprint:plan_guide',
            input: {},
            outcome: { ok: true, output },
            ...invocation
          }
        ],
        toWire
      )[1]!.content as string
    ) as unknown

  it('projects only a host-stamped MCP invocation whose id names the envelope', () => {
    expect(send({ source: { kind: 'mcp', groupId: 'kiprint' } })).not.toHaveProperty('text')
    // No stamp (a host that stamps none, or history restored without it).
    expect(send({})).toEqual(envelope)
    expect(send({ source: { kind: 'plugin' } })).toEqual(envelope)
    expect(send({ source: { kind: 'app', groupId: 'kiprint' } })).toEqual(envelope)
    // Stamped by another server, or an envelope naming another tool.
    expect(send({ source: { kind: 'mcp', groupId: 'other' } })).toEqual(envelope)
    expect(
      send({ source: { kind: 'mcp', groupId: 'kiprint' }, toolId: 'mcp:kiprint:get_project' })
    ).toEqual(envelope)
  })

  it('keeps the full envelope when `text` is not exactly the text-block alias', () => {
    const source = { kind: 'mcp' as const, groupId: 'kiprint' }
    for (const output of [
      { ...envelope, text: 'payload\n' },
      { ...envelope, text: 'a summary the producer wrote' },
      { ...envelope, raw: { content: 'payload' } },
      { ...envelope, raw: null },
      { ...envelope, isError: 'no' },
      'payload'
    ]) {
      expect(send({ source }, output)).toEqual(output)
    }
  })
})
