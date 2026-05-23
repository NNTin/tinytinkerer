import { useAuthStore } from './stores/auth-store'
import { useSettingsStore } from './stores/settings-store'
import { useStatusStore } from './stores/status-store'

export const initializeBrowserStores = async (): Promise<void> => {
  await Promise.all([
    useAuthStore.getState().initialize(),
    useSettingsStore.getState().initialize(),
    useStatusStore.getState().initialize()
  ])
}
