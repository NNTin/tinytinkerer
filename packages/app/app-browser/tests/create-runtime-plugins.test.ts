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
        inputSchema: {}
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
    description: 'hook plugin',
    capabilities: ['hooks']
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
    const requestBodies: Array<{ messages?: Array<{ content: string }>; stream?: boolean }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        const rawBody = init?.body
        const bodyText = typeof rawBody === 'string' ? rawBody : '{}'
        const body = JSON.parse(bodyText) as {
          messages?: Array<{ content: string }>
          stream?: boolean
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
                          { id: 'understand', summary: 'Understand the request' },
                          { id: 'compose', summary: 'Compose the answer' }
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

    const planningPrompt = requestBodies[0]?.messages?.[0]?.content ?? ''
    expect(planningPrompt).toContain('Tool: web-search')
    expect(planningPrompt).toContain('Search the web for fresh context using Tavily.')
    expect(planningPrompt).not.toContain('plugin override descriptor')
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
