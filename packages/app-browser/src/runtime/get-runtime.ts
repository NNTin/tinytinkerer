import { createRuntime } from './create-runtime'
import { getBrowserShellConfig } from '../shell'
import { useAuthStore } from '../stores/auth-store'
import { useSettingsStore } from '../stores/settings-store'
import { isSearchReady, useStatusStore } from '../stores/status-store'

export const getRuntime = () =>
  createRuntime({
    baseUrl: getBrowserShellConfig().edgeBaseUrl,
    searchEnabled: useSettingsStore.getState().searchEnabled && isSearchReady(useStatusStore.getState()),
    getToken: () => useAuthStore.getState().token,
    getModel: () => useSettingsStore.getState().selectedModel
  })
