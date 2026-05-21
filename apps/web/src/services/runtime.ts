import { AgentRuntime, GitHubModelsProvider, ToolRegistry, createWebSearchTool } from '@tinytinkerer/agent-core'
import { useAuthStore } from '../stores/auth-store'

const edgeUrl = import.meta.env.VITE_EDGE_URL ?? 'http://127.0.0.1:8787'

const registry = new ToolRegistry()
registry.register(createWebSearchTool(edgeUrl))

const provider = new GitHubModelsProvider({
  baseUrl: edgeUrl,
  getToken: () => useAuthStore.getState().token
})

export const runtime = new AgentRuntime(provider, registry)
