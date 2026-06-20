import type { ChatRuntimeFactory, PluginModule } from '@tinytinkerer/app-core'
import type { InspectorRequestPayload } from '@tinytinkerer/contracts'
import type { BrowserShell } from '../shell'
import type { AuthStore } from '../stores/auth-store'
import type { SettingsStore } from '../stores/settings-store'
import { createPluginRuntime, createRuntime } from './create-runtime'

export const createBrowserRuntimeFactory = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  // Plugins the caller discovered dynamically (see ../plugins/registry). Optional
  // so a host with no plugins — or a test — can omit them entirely.
  pluginModules?: PluginModule[]
  // Optional client-only capture sink for the context-inspector plugin (#270).
  // createRuntime only forwards it to the provider when that plugin is enabled.
  captureForwardedRequest?: (payload: InspectorRequestPayload) => void
}): ChatRuntimeFactory => {
  const pluginRuntime = createPluginRuntime(options.pluginModules ?? [])

  return {
    create: () => {
      const settings = options.settingsStore.getState()
      return createRuntime({
        baseUrl: options.shell.config.edgeBaseUrl,
        getToken: () => options.authStore.getState().token,
        getModel: () => options.settingsStore.getState().selectedModel,
        getLiteLLMBaseUrl: () => options.settingsStore.getState().litellmBaseUrl,
        agentType: settings.agentType,
        mcpServers: settings.mcpServers,
        mcpDiscovery: settings.mcpDiscovery,
        pluginActivation: settings.pluginActivation,
        pluginRuntime,
        ...(options.captureForwardedRequest
          ? { captureForwardedRequest: options.captureForwardedRequest }
          : {})
      })
    }
  }
}
