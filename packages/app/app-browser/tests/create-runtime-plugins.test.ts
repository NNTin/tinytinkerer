import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type {
  AgentHookContribution,
  PluginEdgeFetch,
  PluginModule,
  Tool
} from '@tinytinkerer/app-core'
import { createPluginRuntime, createRuntime } from '../src/runtime/create-runtime.js'

const testTool = (id: string): Tool<unknown, unknown> => ({
  id,
  description: 'test tool',
  schema: z.object({}).passthrough(),
  execute: () => Promise.resolve('ok')
})

const pluginModule = (options: {
  manifestId: string
  pluginId?: string
  toolId: string
  descriptorDescription?: string
  activate?: () => void
  deactivate?: () => void
}): PluginModule => ({
  manifest: {
    id: options.manifestId,
    label: options.manifestId,
    description: 'plugin',
    toolDescriptors: [
      {
        id: options.toolId,
        description: options.descriptorDescription ?? `${options.toolId} descriptor`,
        // Canonical schema (issue #287): the descriptor carries the Zod schema; the
        // host generates the planner-visible JSON Schema from it.
        schema: z.object({}).passthrough()
      }
    ]
  },
  createPlugin: () => ({
    id: options.pluginId ?? options.manifestId,
    createTools: () => [testTool(options.toolId)],
    ...(options.activate ? { activate: options.activate } : {}),
    ...(options.deactivate ? { deactivate: options.deactivate } : {})
  })
})

const hookPluginModule = (id: string, hook: AgentHookContribution): PluginModule => ({
  manifest: {
    id,
    label: id,
    description: 'hook plugin'
  },
  createPlugin: () => ({
    id,
    createHooks: () => [hook]
  })
})

const runRuntime = async (runtime: ReturnType<typeof createRuntime>): Promise<void> => {
  for await (const event of runtime.run('hello')) {
    void event
    // Drain the runtime.
  }
}

describe('plugin runtime contributions', () => {
  it('skips a plugin whose manifest id does not match the created plugin id', () => {
    const runtime = createPluginRuntime([
      pluginModule({ manifestId: 'manifest-id', pluginId: 'plugin-id', toolId: 'bad_tool' })
    ])

    expect(runtime.registry.list()).toEqual([])
    expect([...runtime.modulesById.keys()]).toEqual([])
  })

  it('keeps the first plugin when duplicate manifest ids are discovered', () => {
    const runtime = createPluginRuntime([
      pluginModule({ manifestId: 'dup', toolId: 'first_tool' }),
      pluginModule({ manifestId: 'dup', toolId: 'second_tool' })
    ])

    expect(runtime.registry.list().map((plugin) => plugin.id)).toEqual(['dup'])
    expect([...runtime.modulesById.keys()]).toEqual(['dup'])
  })

  it('does not expose plugin descriptors for tools that collide with existing tools', async () => {
    const requestBodies: Array<{
      messages?: Array<{ content: string }>
      stream?: boolean
      tools?: Array<{ function: { name: string; description?: string } }>
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const rawBody = init?.body
        const bodyText = typeof rawBody === 'string' ? rawBody : '{}'
        const body = JSON.parse(bodyText) as {
          messages?: Array<{ content: string }>
          stream?: boolean
          tools?: Array<{ function: { name: string; description?: string } }>
        }
        requestBodies.push(body)
        if (body.stream === false) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      // Structured-output wire shape (issue #287): toolCall is a
                      // required-but-nullable field and input is a JSON string.
                      content: JSON.stringify({
                        complexity: 'low',
                        steps: [
                          { id: 'understand', summary: 'Understand the request', toolCall: null },
                          { id: 'compose', summary: 'Compose the answer', toolCall: null }
                        ]
                      })
                    }
                  }
                ]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          )
        }

        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    const runtime = createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      pluginActivation: { 'web-search': true, colliding: true },
      // The web-search plugin (discovered first) owns the 'web-search' tool id; a
      // second plugin claiming the same id must not override its planner
      // descriptor.
      pluginModules: [
        pluginModule({
          manifestId: 'web-search',
          toolId: 'web-search',
          descriptorDescription: 'Search the web for fresh context using Tavily.'
        }),
        pluginModule({
          manifestId: 'colliding',
          toolId: 'web-search',
          descriptorDescription: 'plugin override descriptor'
        })
      ]
    })

    await runRuntime(runtime)

    // Tools are advertised natively on the request (issue #287), so the planner
    // descriptor reaches the model via the `tools` array, not the prompt text. The
    // first plugin to claim 'web-search' owns the descriptor; the collider's
    // override never advertises.
    const advertisedTools = requestBodies[0]?.tools ?? []
    const webSearch = advertisedTools.find((t) => t.function.name === 'web-search')
    expect(webSearch?.function.description).toBe('Search the web for fresh context using Tavily.')
    expect(advertisedTools.map((t) => t.function.description)).not.toContain(
      'plugin override descriptor'
    )
    vi.unstubAllGlobals()
  })

  it("surfaces an MCP tool's DISCOVERED JSON Schema to the planner unchanged (issue #287)", async () => {
    // An MCP tool has no local Zod source — its single source of truth is the
    // remote server's discovered JSON Schema. The canonical schema path must pass
    // that through to the planner descriptor verbatim (no re-derivation), distinct
    // from the plugin path that GENERATES JSON Schema from a Zod schema.
    const requestBodies: Array<{
      messages?: Array<{ content: string }>
      stream?: boolean
      tools?: Array<{ function: { name: string; parameters?: Record<string, unknown> } }>
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages?: Array<{ content: string }>
          stream?: boolean
          tools?: Array<{ function: { name: string; parameters?: Record<string, unknown> } }>
        }
        requestBodies.push(body)
        if (body.stream === false) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        complexity: 'low',
                        steps: [
                          { id: 'understand', summary: 'u', toolCall: null },
                          { id: 'compose', summary: 'c', toolCall: null }
                        ]
                      })
                    }
                  }
                ]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          )
        }
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    const discoveredSchema = {
      type: 'object',
      properties: { location: { type: 'string', description: 'City name' } },
      required: ['location']
    }
    const runtime = createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      mcpServers: [{ id: 'srv', name: 'MyServer', url: 'https://mcp.example/sse', enabled: true }],
      mcpDiscovery: {
        srv: {
          serverId: 'srv',
          serverName: 'MyServer',
          syncedAt: new Date().toISOString(),
          tools: [
            { toolName: 'get_weather', description: 'Get weather', inputSchema: discoveredSchema }
          ]
        }
      }
    })

    await runRuntime(runtime)

    // The MCP tool is advertised natively (issue #287). Its runtime id
    // `mcp:srv:get_weather` is sanitized to a wire-safe function name, and its
    // DISCOVERED JSON Schema reaches the planner verbatim as `function.parameters`
    // (the `location` property and its `required` entry survive the descriptor build).
    const advertisedTools = requestBodies[0]?.tools ?? []
    const weather = advertisedTools.find((t) => t.function.name === 'mcp_srv_get_weather')
    expect(weather).toBeDefined()
    const params = JSON.stringify(weather?.function.parameters ?? {})
    expect(params).toContain('"location"')
    expect(params).toContain('"required"')
    vi.unstubAllGlobals()
  })

  it('registers app-local tools and surfaces a planner descriptor derived from their Zod schema', async () => {
    // App tools (e.g. the canvas app's Excalidraw tools) are injected straight
    // into the runtime — not discovered as plugins and not activation-gated. They
    // must register and advertise natively, with parameters generated from their
    // own Zod schema, the same canonical path plugin tools use (issue #287).
    const requestBodies: Array<{
      messages?: Array<{ content: string }>
      stream?: boolean
      tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages?: Array<{ content: string }>
          stream?: boolean
          tools?: Array<{ function: { name: string; description?: string; parameters?: unknown } }>
        }
        requestBodies.push(body)
        if (body.stream === false) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        complexity: 'low',
                        steps: [
                          { id: 'understand', summary: 'u', toolCall: null },
                          { id: 'compose', summary: 'c', toolCall: null }
                        ]
                      })
                    }
                  }
                ]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          )
        }
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    const drawTool: Tool<{ shapeKind: string }, unknown> = {
      id: 'draw_on_canvas',
      description: 'Draw shapes on the Excalidraw canvas.',
      schema: z.object({ shapeKind: z.string() }),
      execute: () => Promise.resolve({ ok: true })
    }

    const runtime = createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      appTools: [drawTool]
    })

    await runRuntime(runtime)

    // Tools are advertised natively on the request (issue #287): the app tool
    // reaches the model via the `tools` array with parameters generated from its
    // own Zod schema.
    const advertisedTools = requestBodies[0]?.tools ?? []
    const drawn = advertisedTools.find((t) => t.function.name === 'draw_on_canvas')
    expect(drawn?.function.description).toBe('Draw shapes on the Excalidraw canvas.')
    expect(JSON.stringify(drawn?.function.parameters)).toContain('"shapeKind"')
    vi.unstubAllGlobals()
  })

  it('does not let an app tool override a plugin tool that already claimed its id', async () => {
    // App tools register after MCP + plugins; addTool dedupes, first writer wins.
    const requestBodies: Array<{
      messages?: Array<{ content: string }>
      stream?: boolean
      tools?: Array<{ function: { name: string; description?: string } }>
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          messages?: Array<{ content: string }>
          stream?: boolean
          tools?: Array<{ function: { name: string; description?: string } }>
        }
        requestBodies.push(body)
        if (body.stream === false) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        complexity: 'low',
                        steps: [{ id: 'understand', summary: 'u', toolCall: null }]
                      })
                    }
                  }
                ]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          )
        }
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    const runtime = createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      pluginActivation: { owner: true },
      pluginModules: [
        pluginModule({
          manifestId: 'owner',
          toolId: 'shared_id',
          descriptorDescription: 'plugin owns this id'
        })
      ],
      appTools: [
        {
          id: 'shared_id',
          description: 'app override should be dropped',
          schema: z.object({}).passthrough(),
          execute: () => Promise.resolve('ok')
        }
      ]
    })

    await runRuntime(runtime)

    // The first plugin to claim 'shared_id' owns the advertised descriptor; the
    // app tool's override is dropped (addTool dedupes, first writer wins).
    const advertisedTools = requestBodies[0]?.tools ?? []
    const shared = advertisedTools.find((t) => t.function.name === 'shared_id')
    expect(shared?.function.description).toBe('plugin owns this id')
    expect(advertisedTools.map((t) => t.function.description)).not.toContain(
      'app override should be dropped'
    )
    vi.unstubAllGlobals()
  })

  it('fires deactivate when a persistent plugin runtime sees a plugin turn off', () => {
    const activate = vi.fn()
    const deactivate = vi.fn()
    const pluginRuntime = createPluginRuntime([
      pluginModule({ manifestId: 'lifecycle', toolId: 'lifecycle_tool', activate, deactivate })
    ])
    const baseOptions = {
      baseUrl: 'http://edge.local',
      getToken: () => null,
      getModel: () => 'openai/gpt-4.1-mini',
      pluginRuntime
    }

    createRuntime({
      ...baseOptions,
      pluginActivation: { lifecycle: true }
    })
    createRuntime({
      ...baseOptions,
      pluginActivation: { lifecycle: false }
    })

    expect(activate).toHaveBeenCalledTimes(1)
    expect(deactivate).toHaveBeenCalledTimes(1)
  })

  it('passes active plugin hooks into the browser runtime', async () => {
    const observed: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      )
    )

    const runtime = createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      pluginActivation: { observer: true },
      pluginModules: [
        hookPluginModule('observer', {
          event: 'chat.event',
          handler: ({ event }) => {
            observed.push(event.type)
          }
        })
      ]
    })

    await runRuntime(runtime)

    expect(observed).toContain('assistant.done')
    vi.unstubAllGlobals()
  })

  // TINYTINKERER-FRONTEND-11: web search is `defaultEnabled` and anonymous chat is
  // allowed, but /api/search requires an authenticated caller. The host must NOT
  // make that request (which would deterministically 401 and be captured) when no
  // token is present — it short-circuits to a clean 401 with no network round-trip.
  const captureHostEdgeFetch = (): {
    module: PluginModule
    getEdgeFetch: () => PluginEdgeFetch | undefined
  } => {
    let captured: PluginEdgeFetch | undefined
    const module: PluginModule = {
      manifest: { id: 'edge-probe', label: 'edge-probe', description: 'edge probe plugin' },
      createPlugin: () => ({
        id: 'edge-probe',
        createTools: (host) => {
          captured = host.edgeFetch
          return []
        }
      })
    }
    return { module, getEdgeFetch: () => captured }
  }

  it('short-circuits an anonymous plugin edge call to 401 without a network request (TINYTINKERER-FRONTEND-11)', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    const { module, getEdgeFetch } = captureHostEdgeFetch()

    createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => null, // anonymous caller
      getModel: () => 'openai/gpt-4.1-mini',
      pluginActivation: { 'edge-probe': true },
      pluginModules: [module]
    })

    const edgeFetch = getEdgeFetch()
    expect(edgeFetch).toBeDefined()
    const response = await edgeFetch!('/api/search', { query: 'x' }, { area: 'search' })

    expect(response.ok).toBe(false)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    // The whole point of the fix: no request leaves the client, so no 401 is captured.
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('performs the plugin edge request when a token is present (real failures stay loud)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)
    const { module, getEdgeFetch } = captureHostEdgeFetch()

    createRuntime({
      baseUrl: 'http://edge.local',
      getToken: () => 'token',
      getModel: () => 'openai/gpt-4.1-mini',
      pluginActivation: { 'edge-probe': true },
      pluginModules: [module]
    })

    await getEdgeFetch()!('/api/search', { query: 'x' }, { area: 'search' })
    // Authenticated calls go to the edge as before, so a token-present 401/403
    // (invalid/forbidden caller) still hits fetchWithTelemetry and stays captured.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
