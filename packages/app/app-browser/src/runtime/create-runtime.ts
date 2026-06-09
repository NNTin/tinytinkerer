import {
  createChatRuntime,
  isRuntimeTimeoutError,
  PluginRegistry,
  resolveActivePluginIds,
  type PluginHost,
  type PluginModule,
  type Tool
} from '@tinytinkerer/app-core'
import type {
  AgentType,
  McpDiscoveryResult,
  McpServerConfig,
  PluginActivationState
} from '@tinytinkerer/contracts'
import { LiteLLMProvider } from './litellm-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch } from './edge-fetch'
import { createWebSearchTool } from './web-search-tool'
import { createMcpTool } from './mcp-tool'
import {
  captureTelemetryException,
  captureTelemetryMessage,
  fingerprintMessage
} from '../telemetry/telemetry'

export type BrowserPluginRuntime = {
  registry: PluginRegistry
  modulesById: ReadonlyMap<string, PluginModule>
}

export const createPluginRuntime = (
  pluginModules: readonly PluginModule[] = []
): BrowserPluginRuntime => {
  const registry = new PluginRegistry()
  const modulesById = new Map<string, PluginModule>()

  for (const mod of pluginModules) {
    if (modulesById.has(mod.manifest.id)) {
      continue
    }

    try {
      const plugin = mod.createPlugin()
      if (plugin.id !== mod.manifest.id) {
        continue
      }
      registry.register(plugin)
      modulesById.set(mod.manifest.id, mod)
    } catch {
      // Optional plugin failed to instantiate — tolerate and skip.
    }
  }

  return { registry, modulesById }
}

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
  getLiteLLMBaseUrl?: () => string | null | undefined
  agentType?: AgentType
  mcpServers?: McpServerConfig[]
  mcpDiscovery?: Record<string, McpDiscoveryResult>
  pluginActivation?: PluginActivationState
  // Plugin modules the host discovered dynamically; only those whose id is
  // active in settings contribute tools and planner descriptors.
  pluginModules?: PluginModule[]
  // Persistent plugin runtime owned by a browser runtime factory. Keeping it
  // outside individual chat runtime instances lets lifecycle hooks observe
  // activation changes across runs.
  pluginRuntime?: BrowserPluginRuntime
}) => {
  const edgeFetch = createEdgeFetch(options.baseUrl, options.getToken)

  const tools: Tool<unknown, unknown>[] = []
  const allToolDescriptors: PlannerToolDescriptor[] = []
  const registeredToolIds = new Set<string>()

  const addTool = (tool: Tool<unknown, unknown>): boolean => {
    if (registeredToolIds.has(tool.id)) {
      return false
    }
    registeredToolIds.add(tool.id)
    tools.push(tool)
    return true
  }

  const addToolWithDescriptor = (
    tool: Tool<unknown, unknown>,
    descriptor: PlannerToolDescriptor
  ): void => {
    if (addTool(tool)) {
      allToolDescriptors.push(descriptor)
    }
  }

  if (options.searchEnabled) {
    addToolWithDescriptor(createWebSearchTool(edgeFetch), {
      id: 'web-search',
      description: 'Search the web for fresh context using Tavily.',
      inputSchema: {
        query: { type: 'string', description: 'Search query (2–500 chars)' },
        maxResults: { type: 'number', description: 'Max results (1–10, optional)' }
      }
    })
  }

  for (const server of options.mcpServers ?? []) {
    if (!server.enabled) continue
    const disc = options.mcpDiscovery?.[server.id]
    if (!disc || disc.error) continue
    for (const toolMeta of disc.tools) {
      addToolWithDescriptor(createMcpTool(server, toolMeta, edgeFetch), {
        id: `mcp:${server.id}:${toolMeta.toolName}`,
        description: `[${server.name}] ${toolMeta.description}`,
        inputSchema: toolMeta.inputSchema
      })
    }
  }

  // Optional plugins: register tools only for the plugins the user activated in
  // Settings. Concrete plugins are discovered dynamically by the host and handed
  // in as `pluginModules`; this layer knows only the generic PluginModule shape.
  // The capture sink forwards structured plugin reports (e.g. feedback) to
  // telemetry; it no-ops unless telemetry consent is granted. An `info` report is
  // routed to `captureTelemetryMessage` so it surfaces as an informational
  // message (not an error issue); `warning`/`error` go through the exception path.
  const activePluginIds = resolveActivePluginIds(options.pluginActivation ?? {})
  const pluginRuntime =
    options.pluginRuntime ?? createPluginRuntime(options.pluginModules ?? [])
  const activePluginModules = [...pluginRuntime.modulesById.values()].filter(
    (mod) => activePluginIds.has(mod.manifest.id)
  )
  if (activePluginIds.size > 0 || pluginRuntime.registry.list().length > 0) {
    const pluginHost: PluginHost = {
      capture: (report) => {
        const captureOptions = {
          level: report.level ?? 'warning',
          tags: { plugin: report.pluginId, plugin_kind: report.kind },
          ...(report.contexts ? { contexts: report.contexts } : {}),
          fingerprint: ['plugin', report.pluginId, report.kind]
        }
        if (report.level === 'info') {
          captureTelemetryMessage(report.message, captureOptions)
        } else {
          captureTelemetryException(report.message, captureOptions)
        }
      }
    }
    const addedPluginToolIds = new Set<string>()
    for (const tool of pluginRuntime.registry.collectTools(activePluginIds, pluginHost)) {
      if (addTool(tool)) {
        addedPluginToolIds.add(tool.id)
      }
    }
    for (const mod of activePluginModules) {
      for (const descriptor of mod.manifest.toolDescriptors ?? []) {
        if (addedPluginToolIds.has(descriptor.id)) {
          allToolDescriptors.push(descriptor)
        }
      }
    }
  }

  return createChatRuntime({
    ...(options.agentType ? { agentType: options.agentType } : {}),
    provider: new LiteLLMProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      ...(options.getLiteLLMBaseUrl
        ? { getLiteLLMBaseUrl: options.getLiteLLMBaseUrl }
        : {}),
      allToolDescriptors
    }),
    // Terminal runtime failures (e.g. a ReAct decision timeout, a provider/edge
    // error, or a rate limit that escaped the cooldown path) are swallowed into
    // a friendly fallback for the user; route them to Sentry here so they are
    // not lost. No-ops without telemetry consent. Aborts and handled rate-limit
    // cooldowns never reach this sink. The fingerprint keeps each distinct
    // failure its own issue rather than collapsing them under the shared frame.
    //
    // A RuntimeTimeoutError (a slow model tripped the planner / decision budget —
    // e.g. openai/gpt-5 via LiteLLM) is reported at `warning`, not `error`: the
    // run degraded into a friendly fallback rather than crashing, so it should be
    // visible to spot a misbehaving model/route without paging like an unexpected
    // exception (TINYTINKERER-FRONTEND-S). The `reason: 'timeout'` tag lets triage
    // filter these out of the hard-error signal.
    reportError: (error) => {
      const timedOut = isRuntimeTimeoutError(error)
      captureTelemetryException(error, {
        level: timedOut ? 'warning' : 'error',
        tags: { source: 'agent-runtime', ...(timedOut ? { reason: 'timeout' } : {}) },
        fingerprint: ['agent-runtime', fingerprintMessage(error.message)]
      })
    },
    createAssistantContentSession: async (initialSource = '') => {
      const { createMarkdownContentSession } = await import('@tinytinkerer/content-markdown')
      const session = createMarkdownContentSession(initialSource)
      return {
        append(chunk) {
          const snapshot = session.append(chunk)
          return { source: snapshot.source, content: snapshot.document }
        },
        replace(source) {
          const snapshot = session.replace(source)
          return { source: snapshot.source, content: snapshot.document }
        },
        snapshot() {
          const snapshot = session.snapshot()
          return { source: snapshot.source, content: snapshot.document }
        }
      }
    },
    tools,
    searchEnabled: options.searchEnabled
  })
}
