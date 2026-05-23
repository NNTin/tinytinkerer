import { AgentRuntime, GitHubModelsProvider, ToolRegistry, createWebSearchTool } from '@tinytinkerer/agent-core'
import { useAuthStore } from '../stores/auth-store.js'
import { useSettingsStore } from '../stores/settings-store.js'
import { edgeUrl } from './config.js'
import { normalizeSelectedModel } from './models.js'

const provider = new GitHubModelsProvider({
  baseUrl: edgeUrl,
  getToken: () => useAuthStore.getState().token,
  getModel: () => normalizeSelectedModel(useSettingsStore.getState().selectedModel)
})

export const getRuntime = (): AgentRuntime => {
  const { searchEnabled } = useSettingsStore.getState()
  const registry = new ToolRegistry()
  if (searchEnabled) {
    registry.register(createWebSearchTool(edgeUrl))
  }
  return new AgentRuntime(provider, registry, { searchEnabled })
}
