import { createChatRuntime, type Tool } from '@tinytinkerer/app-core'
import type { McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { GitHubModelsProvider, type McpToolDescriptor } from './github-models-provider'
import { createEdgeFetch } from './edge-fetch'
import { createWebSearchTool } from './web-search-tool'
import { createMcpTool } from './mcp-tool'

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
  mcpServers?: McpServerConfig[]
  mcpDiscovery?: Record<string, McpDiscoveryResult>
}) => {
  const edgeFetch = createEdgeFetch(options.baseUrl, options.getToken)

  const tools: Tool<unknown, unknown>[] = options.searchEnabled ? [createWebSearchTool(edgeFetch)] : []

  const mcpDescriptors: McpToolDescriptor[] = []
  for (const server of options.mcpServers ?? []) {
    if (!server.enabled) continue
    const disc = options.mcpDiscovery?.[server.id]
    if (!disc || disc.error) continue
    for (const toolMeta of disc.tools) {
      tools.push(createMcpTool(server, toolMeta, edgeFetch))
      const descriptor: McpToolDescriptor = {
        id: `mcp:${server.id}:${toolMeta.toolName}`,
        description: `[${server.name}] ${toolMeta.description}`,
        inputSchema: toolMeta.inputSchema
      }
      if (disc.instructions) {
        descriptor.serverInstructions = disc.instructions
      }
      mcpDescriptors.push(descriptor)
    }
  }

  return createChatRuntime({
    provider: new GitHubModelsProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      mcpToolDescriptors: mcpDescriptors
    }),
    createAssistantContentSession: async (initialSource = '') => {
      const { createMarkdownContentSession } = await import('@tinytinkerer/content-markdown')
      const session = createMarkdownContentSession(initialSource)
      return {
        append(chunk) {
          const snapshot = session.append(chunk)
          return {
            source: snapshot.source,
            content: snapshot.document
          }
        },
        replace(source) {
          const snapshot = session.replace(source)
          return {
            source: snapshot.source,
            content: snapshot.document
          }
        },
        snapshot() {
          const snapshot = session.snapshot()
          return {
            source: snapshot.source,
            content: snapshot.document
          }
        }
      }
    },
    tools,
    searchEnabled: options.searchEnabled
  })
}
