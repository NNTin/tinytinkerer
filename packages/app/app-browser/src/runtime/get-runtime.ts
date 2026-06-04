import type { ChatRuntimeFactory, PluginModule } from '@tinytinkerer/app-core'
import type { BrowserShell } from '../shell'
import type { AuthStore } from '../stores/auth-store'
import type { SettingsStore } from '../stores/settings-store'
import { isSearchReady, type StatusStore } from '../stores/status-store'
import { createPluginRuntime, createRuntime } from './create-runtime'

export const createBrowserRuntimeFactory = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  statusStore: StatusStore
  // Plugins the caller discovered dynamically (see ../plugins/registry). Optional
  // so a host with no plugins — or a test — can omit them entirely.
  pluginModules?: PluginModule[]
}): ChatRuntimeFactory => {
  const pluginRuntime = createPluginRuntime(options.pluginModules ?? [])

  return {
    create: () => {
      const settings = options.settingsStore.getState()
      return createRuntime({
        baseUrl: options.shell.config.edgeBaseUrl,
        searchEnabled:
          settings.searchEnabled && isSearchReady(options.statusStore.getState()),
        getProvider: () => options.settingsStore.getState().selectedModelProvider,
        getToken: () => {
          const current = options.settingsStore.getState()
          return current.selectedModelProvider === 'openrouter'
            ? current.openRouterApiKey
            : options.authStore.getState().token
        },
        getModel: () => options.settingsStore.getState().selectedModel,
        agentType: settings.agentType,
        mcpServers: settings.mcpServers,
        mcpDiscovery: settings.mcpDiscovery,
        pluginActivation: settings.pluginActivation,
        pluginRuntime
      })
    }
  }
}
