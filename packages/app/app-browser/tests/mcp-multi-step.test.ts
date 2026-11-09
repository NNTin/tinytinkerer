import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Tool } from '@tinytinkerer/app-core'
import { DEFAULT_MAX_ITERATIONS } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  type McpCallRequest,
  type McpCallResponse,
  type McpDiscoveryResult,
  type McpServerConfig
} from '@tinytinkerer/contracts'
import { createRuntime } from '../src/runtime/create-runtime.js'

// Issue #510, T4: MCP tools run in the runtime's native ReAct tool-calling loop,
// so one user turn can call a tool, read its result, and decide the next call —
// many times over. The scenario is KiPrint's iterative wire-guide workflow:
// create a project, place parts, wire, check, fix what the check reported, check
// again, plan, export, and read the project back.
//
// Two halves stand in for the network. The mock MCP server sits behind the edge's
// `/api/mcp/call` route and is stateful: it mints the projectId, remembers what
// was placed, and reports a real wiring fault. The scripted model sits behind
// `/api/models/chat` and is DRIVEN BY THOSE RESULTS — it learns the projectId,
// the faulty wire id and the download URL only by reading the `tool` messages the
// runtime replays to it. A runtime that planned the calls up front, or that lost
// a result between steps, could not produce the sequence asserted below.

const SERVER: McpServerConfig = {
  id: 'kiprint',
  name: 'KiPrint',
  url: 'https://kiprint.test/mcp',
  enabled: true
}

const KIPRINT_TOOLS = [
  'create_project',
  'add_components',
  'add_wires',
  'remove_items',
  'check_project',
  'plan_guide',
  'export_project',
  'get_project'
] as const

const DISCOVERY: Record<string, McpDiscoveryResult> = {
  [SERVER.id]: {
    serverId: SERVER.id,
    serverName: SERVER.name,
    syncedAt: '2026-11-09T00:00:00.000Z',
    tools: KIPRINT_TOOLS.map((toolName) => ({
      toolName,
      description: `KiPrint ${toolName}`,
      // Fail-open schema: the local triage validator passes any object through.
      inputSchema: { type: 'object', properties: {}, additionalProperties: true }
    }))
  }
}

type Wire = { id: string; from: string; to: string }

// A minimal, stateful KiPrint: enough behaviour that every step's arguments
// depend on an earlier step's result.
const createMockKiPrint = () => {
  const projectId = crypto.randomUUID()
  const refs = new Set<string>()
  const wires = new Map<string, Wire>()
  const calls: McpCallRequest[] = []
  let exportToken = 0

  const respond = (toolName: string, payload: unknown, isError = false): McpCallResponse => {
    const text = JSON.stringify(payload)
    return {
      serverName: SERVER.name,
      toolName,
      text,
      raw: { content: [{ type: 'text', text }] },
      isError
    }
  }

  // A pin is `<ref>.<pad>`; it is valid only when its component was placed.
  const pinExists = (pin: string): boolean => refs.has(pin.split('.')[0] ?? '')

  const call = (request: McpCallRequest): McpCallResponse => {
    calls.push(request)
    const args = request.arguments
    if (request.toolName !== 'create_project' && args.projectId !== projectId) {
      return respond(request.toolName, { error: 'unknown projectId' }, true)
    }

    switch (request.toolName) {
      case 'create_project':
        return respond('create_project', {
          projectId,
          board: { partId: args.boardPartId, cols: 30, rows: 20 }
        })
      case 'add_components': {
        for (const component of args.components as { ref: string }[]) refs.add(component.ref)
        return respond('add_components', { added: [...refs] })
      }
      case 'add_wires': {
        for (const wire of args.wires as Wire[]) wires.set(wire.id, wire)
        return respond('add_wires', { wires: [...wires.keys()] })
      }
      case 'remove_items': {
        for (const id of (args.wireIds as string[] | undefined) ?? []) wires.delete(id)
        return respond('remove_items', { wires: [...wires.keys()] })
      }
      case 'check_project': {
        const issues = [...wires.values()]
          .filter((wire) => !pinExists(wire.from) || !pinExists(wire.to))
          .map((wire) => ({
            code: 'dangling_wire',
            message: `Wire ${wire.id} ends on a component that was never placed`,
            wireId: wire.id
          }))
        return respond('check_project', { ok: issues.length === 0, issues })
      }
      case 'plan_guide':
        return respond('plan_guide', { channels: wires.size, layers: 1 })
      case 'export_project':
        exportToken += 1
        return respond('export_project', {
          url: `https://kiprint.test/downloads/signed-${projectId}-${exportToken}`,
          expiresAt: '2026-11-16T00:00:00.000Z'
        })
      case 'get_project':
        return respond('get_project', {
          projectId,
          components: [...refs],
          wires: [...wires.values()]
        })
      default:
        return respond(request.toolName, { error: 'unknown tool' }, true)
    }
  }

  return { projectId, calls, call }
}

type WireMessage = { role: string; content: string | null }
type ModelRequest = {
  messages: WireMessage[]
  tools?: { function: { name: string } }[]
  tool_choice?: string
}

// The fields the scripted model reads back out of KiPrint's results.
type ResultData = {
  projectId?: string
  ok?: boolean
  issues?: { wireId: string }[]
  url?: string
}
type ToolResult = { toolName: string; data: ResultData }

// The MCP results the model has seen so far, decoded from the `tool` messages
// the runtime replays: each is the edge's McpCallResponse, whose `text` is the
// server's own JSON. An app tool's result has no `text` and is skipped.
const readResults = (messages: WireMessage[]): ToolResult[] =>
  messages.flatMap((message) => {
    if (message.role !== 'tool' || !message.content) return []
    const response = JSON.parse(message.content) as Partial<McpCallResponse>
    return typeof response.text === 'string' && typeof response.toolName === 'string'
      ? [{ toolName: response.toolName, data: JSON.parse(response.text) as ResultData }]
      : []
  })

type Decide = (messages: WireMessage[]) => { tool: string; args: Record<string, unknown> } | null

// The scripted model: picks its next call from the LAST result alone, plus the
// projectId it read out of the create_project result. Returns null to finish.
const kiprintWorkflow: Decide = (messages) => {
  const results = readResults(messages)
  const last = results.at(-1)
  const projectId = results.find((result) => result.toolName === 'create_project')?.data.projectId
  if (!last) {
    return { tool: 'create_project', args: { boardPartId: 'stripboard-30x20', title: 'Blinky' } }
  }
  switch (last.toolName) {
    case 'create_project':
      return {
        tool: 'add_components',
        args: {
          projectId,
          components: [
            { ref: 'R1', footprint: 'R_0805', at: [2, 3], rotation: 0 },
            { ref: 'D1', footprint: 'LED_0805', at: [6, 3], rotation: 0 }
          ]
        }
      }
    case 'add_components':
      return {
        tool: 'add_wires',
        args: {
          projectId,
          wires: [
            { id: 'w1', from: 'R1.2', to: 'D1.1' },
            // A mistake the check must catch: J1 was never placed.
            { id: 'w2', from: 'D1.2', to: 'J1.1' }
          ]
        }
      }
    case 'add_wires':
    case 'remove_items':
      return last.toolName === 'remove_items'
        ? {
            tool: 'add_wires',
            args: { projectId, wires: [{ id: 'w3', from: 'D1.2', to: 'R1.1' }] }
          }
        : { tool: 'check_project', args: { projectId } }
    case 'check_project':
      return last.data.ok
        ? { tool: 'plan_guide', args: { projectId } }
        : {
            tool: 'remove_items',
            args: {
              projectId,
              wireIds: (last.data.issues ?? []).map((issue) => issue.wireId)
            }
          }
    case 'plan_guide':
      return { tool: 'export_project', args: { projectId } }
    case 'export_project':
      return { tool: 'get_project', args: { projectId } }
    default:
      return null
  }
}

const sse = (...events: Record<string, unknown>[]): string =>
  `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`

const prose = (text: string): string => sse({ choices: [{ delta: { content: text } }] })

const toolCallSse = (name: string, args: Record<string, unknown>, index: number): string =>
  sse({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: `call-${index}`, function: { name, arguments: JSON.stringify(args) } }
          ]
        }
      }
    ]
  })

const harness = (
  options: { maxIterations?: number; appTools?: Tool<unknown, unknown>[]; decide?: Decide } = {}
) => {
  const decide = options.decide ?? kiprintWorkflow
  const kiprint = createMockKiPrint()
  const decisions: ModelRequest[] = []
  let syntheses = 0

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown
    if (url.endsWith(EDGE_ROUTE_PATHS.mcpCall)) {
      const response = kiprint.call(body as McpCallRequest)
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }))
    }

    const request = body as ModelRequest
    if (request.tool_choice === 'none') {
      // Synthesis: quote the export URL exactly as the tool returned it.
      syntheses += 1
      const exported = readResults(request.messages).find(
        (result) => result.toolName === 'export_project'
      )
      return Promise.resolve(
        new Response(prose(`Download: ${exported?.data.url ?? 'none'}`), { status: 200 })
      )
    }

    decisions.push(request)
    const next = decide(request.messages)
    if (!next) {
      return Promise.resolve(new Response(prose('The guide is ready.'), { status: 200 }))
    }
    // Address the tool by the wire name the runtime advertised, the way a real
    // model must: the runtime id `mcp:kiprint:<tool>` is not a legal name.
    const wireName = request.tools
      ?.map((tool) => tool.function.name)
      .find((name) => name === next.tool || name.endsWith(`_${next.tool}`))
    if (!wireName) throw new Error(`tool ${next.tool} was not advertised`)
    return Promise.resolve(
      new Response(toolCallSse(wireName, next.args, decisions.length), { status: 200 })
    )
  })

  const runtime = createRuntime({
    baseUrl: '',
    getToken: () => 'token',
    getModel: () => 'openai/gpt-4.1-mini',
    agentType: 'react',
    mcpServers: [SERVER],
    mcpDiscovery: DISCOVERY,
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
    ...(options.appTools
      ? { appToolGroup: { id: 'canfactory', label: 'CanFactory', tools: options.appTools } }
      : {})
  })

  const run = async () => {
    let answer = ''
    let steps = -1
    for await (const event of runtime.run('Design a wire guide for a blinking LED.')) {
      if (event.type === 'agent.run.completed') {
        steps = event.payload.steps
      }
      if (event.type === 'assistant.done') {
        answer = (event.payload as { source: string }).source
      }
    }
    return { answer, steps }
  }

  return { kiprint, decisions, syntheses: () => syntheses, run }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('multi-step MCP tool calling in one turn (issue #510, T4)', () => {
  it('defaults the per-turn step bound to 16', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(16)
  })

  it("runs KiPrint's ten-call workflow, each call chosen from the previous result", async () => {
    const test = harness()

    const { answer, steps } = await test.run()

    expect(test.kiprint.calls.map((call) => call.toolName)).toEqual([
      'create_project',
      'add_components',
      'add_wires',
      'check_project',
      'remove_items',
      'add_wires',
      'check_project',
      'plan_guide',
      'export_project',
      'get_project'
    ])
    // The projectId exists only in create_project's result; every later call
    // carries it, so the model read it back rather than guessing.
    for (const call of test.kiprint.calls.slice(1)) {
      expect(call.arguments.projectId).toBe(test.kiprint.projectId)
    }
    // The fix targets exactly the wire the first check reported…
    expect(test.kiprint.calls[4]?.arguments).toMatchObject({ wireIds: ['w2'] })
    // …and the second check, after the fix, came back clean.
    const lastCheck = readResults(test.decisions.at(-1)!.messages)
      .filter((result) => result.toolName === 'check_project')
      .at(-1)
    expect(lastCheck?.data).toEqual({ ok: true, issues: [] })

    // Ten tool decisions plus the closing one, then a single synthesis.
    expect(test.decisions).toHaveLength(11)
    expect(steps).toBe(11)
    expect(test.syntheses()).toBe(1)
    // The download URL reaches the answer exactly as KiPrint returned it.
    expect(answer).toBe(
      `Download: https://kiprint.test/downloads/signed-${test.kiprint.projectId}-1`
    )
  })

  it('stops at a configured, smaller step bound and still answers', async () => {
    const test = harness({ maxIterations: 5 })

    const { steps } = await test.run()

    // Every decision counts toward the bound, so five decisions are five calls
    // when none of them is the closing one.
    expect(test.kiprint.calls.map((call) => call.toolName)).toEqual([
      'create_project',
      'add_components',
      'add_wires',
      'check_project',
      'remove_items'
    ])
    expect(steps).toBe(5)
    expect(test.syntheses()).toBe(1)
  })

  it('interleaves app tools and MCP tools in the same loop', async () => {
    const shown: unknown[] = []
    const showDesign: Tool<unknown, unknown> = {
      id: 'show_design',
      description: 'Show a KiPrint project on the CanFactory stage',
      schema: z.object({ projectId: z.string() }),
      execute: (input) => {
        shown.push(input)
        return Promise.resolve({ shown: true })
      }
    }
    // Create a project over MCP, show it with the app tool, then finish.
    const test = harness({
      appTools: [showDesign],
      decide: (messages) => {
        const created = readResults(messages).find((result) => result.toolName === 'create_project')
        if (!created) return { tool: 'create_project', args: { boardPartId: 'b', title: 't' } }
        if (shown.length === 0) {
          return { tool: 'show_design', args: { projectId: created.data.projectId } }
        }
        return null
      }
    })

    await test.run()

    expect(test.kiprint.calls.map((call) => call.toolName)).toEqual(['create_project'])
    expect(shown).toEqual([{ projectId: test.kiprint.projectId }])
  })
})
