import { AgentRuntime, ToolRegistry } from '@tinytinkerer/agent-core'
import { GitHubModelsProvider } from './github-models-provider'
import { createWebSearchTool } from './web-search-tool'

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
}): AgentRuntime => {
  const provider = new GitHubModelsProvider({
    baseUrl: options.baseUrl,
    getToken: options.getToken,
    getModel: options.getModel
  })

  const registry = new ToolRegistry()
  if (options.searchEnabled) {
    registry.register(createWebSearchTool(options.baseUrl))
  }

  return new AgentRuntime(provider, registry, { searchEnabled: options.searchEnabled })
}
