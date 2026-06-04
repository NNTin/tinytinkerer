import {
  createChatRuntime,
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
  ModelProviderId,
  PluginActivationState
} from '@tinytinkerer/contracts'
import { GitHubModelsProvider } from './github-models-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch } from './edge-fetch'
import { createWebSearchTool } from './web-search-tool'
import { createMcpTool } from './mcp-tool'
import { captureTelemetryException, captureTelemetryMessage } from '../telemetry/telemetry'

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getProvider?: () => ModelProviderId | null | undefined
  getModel: () => string | null | undefined
  agentType?: AgentType
  mcpServers?: McpServerConfig[]
  mcpDiscovery?: Record<string, McpDiscoveryResult>
  pluginActivation?: PluginActivationState
  // Plugin modules the host discovered dynamically; only those whose id is
  // active in settings contribute tools and planner descriptors.
  pluginModules?: PluginModule[]
}) => {
  const edgeFetch = createEdgeFetch(options.baseUrl, options.getToken)

  const tools: Tool<unknown, unknown>[] = []
  const allToolDescriptors: PlannerToolDescriptor[] = []

  if (options.searchEnabled) {
    tools.push(createWebSearchTool(edgeFetch))
    allToolDescriptors.push({
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
      tools.push(createMcpTool(server, toolMeta, edgeFetch))
      allToolDescriptors.push({
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
  const activePluginModules = (options.pluginModules ?? []).filter((mod) =>
    activePluginIds.has(mod.manifest.id)
  )
  if (activePluginModules.length > 0) {
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
    const pluginRegistry = new PluginRegistry()
    for (const mod of activePluginModules) {
      pluginRegistry.register(mod.createPlugin())
    }
    tools.push(...pluginRegistry.collectTools(activePluginIds, pluginHost))
    for (const mod of activePluginModules) {
      for (const descriptor of mod.manifest.toolDescriptors ?? []) {
        allToolDescriptors.push(descriptor)
      }
    }
  }

  return createChatRuntime({
    ...(options.agentType ? { agentType: options.agentType } : {}),
    provider: new GitHubModelsProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      allToolDescriptors,
      ...(options.getProvider ? { getProvider: options.getProvider } : {})
    }),
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
