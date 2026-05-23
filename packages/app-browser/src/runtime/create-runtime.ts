import { AgentRuntime, ToolRegistry } from '@tinytinkerer/agent-core'
import { GitHubModelsProvider } from '../providers/github-models.js'
import { createWebSearchTool } from '../tools/web-search.js'

export type BrowserRuntimeConfig = {
  edgeBaseUrl: string
  getToken?: () => string | null | undefined
  getModel?: () => string | null | undefined
  searchEnabled?: boolean
}

export const createRuntime = (config: BrowserRuntimeConfig): AgentRuntime => {
  const { edgeBaseUrl, getToken, getModel, searchEnabled = true } = config

  const provider = new GitHubModelsProvider({
    baseUrl: edgeBaseUrl,
    ...(getToken !== undefined ? { getToken } : {}),
    ...(getModel !== undefined ? { getModel } : {})
  })

  const registry = new ToolRegistry()
  if (searchEnabled) {
    registry.register(createWebSearchTool(edgeBaseUrl))
  }

  return new AgentRuntime(provider, registry, { searchEnabled })
}
