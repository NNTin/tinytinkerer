import { createChatRuntime, type Tool } from '@tinytinkerer/app-core'
import type { AgentType, McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { GitHubModelsProvider } from './github-models-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch } from './edge-fetch'
import { createWebSearchTool } from './web-search-tool'
import { createMcpTool } from './mcp-tool'

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
  agentType?: AgentType
  mcpServers?: McpServerConfig[]
  mcpDiscovery?: Record<string, McpDiscoveryResult>
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

  return createChatRuntime({
    ...(options.agentType ? { agentType: options.agentType } : {}),
    provider: new GitHubModelsProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      allToolDescriptors
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
