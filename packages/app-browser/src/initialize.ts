import type { BrowserShellConfig } from './config'
import { configureBrowserShell } from './shell'
import { useAuthStore } from './stores/auth-store'
import { useChatStore } from './stores/chat-store'
import { useSettingsStore } from './stores/settings-store'
import { useStatusStore } from './stores/status-store'

export const bootstrapBrowserShell = async (config: BrowserShellConfig): Promise<void> => {
  configureBrowserShell(config)

  await Promise.all([
    useAuthStore.getState().initialize(),
    useChatStore.getState().initialize(),
    useSettingsStore.getState().initialize(),
    useStatusStore.getState().initialize()
  ])
}
