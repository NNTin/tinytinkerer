import { createRuntime } from './create-runtime'
import { getBrowserShellConfig } from '../shell'
import { useAuthStore } from '../stores/auth-store'
import { useSettingsStore } from '../stores/settings-store'

export const getRuntime = () =>
  createRuntime({
    baseUrl: getBrowserShellConfig().edgeBaseUrl,
    searchEnabled: useSettingsStore.getState().searchEnabled,
    getToken: () => useAuthStore.getState().token,
    getModel: () => useSettingsStore.getState().selectedModel
  })
