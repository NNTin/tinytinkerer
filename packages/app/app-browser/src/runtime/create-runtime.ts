import {
  createChatRuntime,
  PluginRegistry,
  resolveActivePluginIds,
  type PluginHost,
  type Tool
} from '@tinytinkerer/app-core'
import type {
  AgentType,
  McpDiscoveryResult,
  McpServerConfig,
  ModelProviderId,
  PluginActivationState
} from '@tinytinkerer/contracts'
import { feedbackPlugin, SEND_FEEDBACK_PLUGIN_ID } from '@tinytinkerer/plugin-feedback'
import { GitHubModelsProvider } from './github-models-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch } from './edge-fetch'
import { createWebSearchTool } from './web-search-tool'
import { createMcpTool } from './mcp-tool'
import { captureTelemetryException } from '../telemetry/telemetry'

// Plugins registered for browser runtimes. Activation gating is applied per run
// from the user's settings; an unlisted/disabled plugin contributes no tools.
const browserPlugins = [feedbackPlugin()]

// Static descriptors so the planner can name plugin tools when active. Kept in
// step with the tools each plugin contributes.
const pluginToolDescriptors: Record<string, PlannerToolDescriptor[]> = {
  [SEND_FEEDBACK_PLUGIN_ID]: [
    {
      id: 'send_feedback',
      description:
        'Send the user’s feedback about TinyTinkerer (bug, idea, or praise) to the maintainers.',
      inputSchema: {
        message: { type: 'string', description: 'The feedback text (1–2000 chars)' },
        category: {
          type: 'string',
          description: 'Optional: bug | idea | praise | general'
        }
      }
    }
  ]
}

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
  // Settings. The capture sink forwards structured plugin reports (e.g. feedback)
  // to telemetry; it no-ops unless telemetry consent is granted.
  const activePluginIds = resolveActivePluginIds(options.pluginActivation ?? {})
  if (activePluginIds.size > 0) {
    const pluginHost: PluginHost = {
      capture: (report) =>
        captureTelemetryException(report.message, {
          level: report.level ?? 'warning',
          tags: { plugin: report.pluginId, plugin_kind: report.kind },
          ...(report.contexts ? { contexts: report.contexts } : {}),
          fingerprint: ['plugin', report.pluginId, report.kind]
        })
    }
    const pluginRegistry = new PluginRegistry()
    for (const plugin of browserPlugins) {
      pluginRegistry.register(plugin)
    }
    tools.push(...pluginRegistry.collectTools(activePluginIds, pluginHost))
    for (const id of activePluginIds) {
      for (const descriptor of pluginToolDescriptors[id] ?? []) {
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
