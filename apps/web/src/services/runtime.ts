import { AgentRuntime, GitHubModelsProvider, ToolRegistry, createWebSearchTool } from '@tinytinkerer/agent-core'
import { useAuthStore } from '../stores/auth-store.js'
import { useSettingsStore } from '../stores/settings-store.js'
import { edgeUrl } from './config.js'

const provider = new GitHubModelsProvider({
  baseUrl: edgeUrl,
  getToken: () => useAuthStore.getState().token,
  getModel: () => useSettingsStore.getState().selectedModel
})

export const getRuntime = (): AgentRuntime => {
  const registry = new ToolRegistry()
  if (useSettingsStore.getState().searchEnabled) {
    registry.register(createWebSearchTool(edgeUrl))
  }
  return new AgentRuntime(provider, registry)
}
