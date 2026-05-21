import { AgentRuntime, GitHubModelsProvider, ToolRegistry, createWebSearchTool } from '@tinytinkerer/agent-core'
import { useAuthStore } from '../stores/auth-store'
import { edgeUrl } from './config'

const registry = new ToolRegistry()
registry.register(createWebSearchTool(edgeUrl))

const provider = new GitHubModelsProvider({
  baseUrl: edgeUrl,
  getToken: () => useAuthStore.getState().token
})

export const runtime = new AgentRuntime(provider, registry)
