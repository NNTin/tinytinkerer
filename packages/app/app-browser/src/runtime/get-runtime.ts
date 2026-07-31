import type { ChatRuntimeFactory, PluginModule } from '@tinytinkerer/app-core'
import type { AppToolGroup } from '../app-tool-group'
import type { AppAssistantPolicy } from '../app-assistant-policy'
import type { BrowserShell } from '../shell'
import type { AuthStore } from '../stores/auth-store'
import type { SettingsStore } from '../stores/settings-store'
import { createPluginRuntime, createRuntime } from './create-runtime'
import type { ForwardedRequestSink } from './edge-fetch'

export const createBrowserRuntimeFactory = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  // Plugins the caller discovered dynamically (see ../plugins/registry). Optional
  // so a host with no plugins — or a test — can omit them entirely.
  pluginModules?: PluginModule[]
  // Optional client-only capture sink for the context-inspector plugin (#270).
  // createRuntime only forwards it to the provider when that plugin is enabled.
  captureForwardedRequest?: ForwardedRequestSink
  // The host app's always-on tool group (e.g. an integrated shell's stage
  // verbs). Forwarded verbatim to createRuntime; omitted by web/mobile.
  appToolGroup?: AppToolGroup
  // The host app's grounding/answer policy (issue #478). Forwarded verbatim to
  // createRuntime; omitted by every app that contributes none.
  appAssistantPolicy?: AppAssistantPolicy
}): ChatRuntimeFactory => {
  const pluginRuntime = createPluginRuntime(options.pluginModules ?? [])

  return {
    // `context` carries the run-scoped conversation id (issue #430) the store
    // resolves before starting the run; forwarded straight into createRuntime,
    // which threads it into the human-prompt bridge and the inspector capture sink.
    create: (context) => {
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
        pluginDisabledTools: settings.pluginDisabledTools,
        appToolDisablement: settings.appToolDisablement,
        pluginRuntime,
        ...(options.captureForwardedRequest
          ? { captureForwardedRequest: options.captureForwardedRequest }
          : {}),
        ...(options.appToolGroup ? { appToolGroup: options.appToolGroup } : {}),
        ...(options.appAssistantPolicy ? { appAssistantPolicy: options.appAssistantPolicy } : {}),
        ...(context?.conversationId ? { conversationId: context.conversationId } : {})
      })
    }
  }
}
