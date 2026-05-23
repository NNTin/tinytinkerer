import { createRuntime } from '@tinytinkerer/app-browser'
import { useAuthStore } from '../stores/auth-store.js'
import { useSettingsStore } from '../stores/settings-store.js'
import { edgeUrl } from './config.js'
import { normalizeSelectedModel } from './models.js'
import type { AgentRuntime } from '@tinytinkerer/app-browser'

export const getRuntime = (): AgentRuntime => {
  const { searchEnabled } = useSettingsStore.getState()
  return createRuntime({
    edgeBaseUrl: edgeUrl,
    getToken: () => useAuthStore.getState().token,
    getModel: () => normalizeSelectedModel(useSettingsStore.getState().selectedModel),
    searchEnabled
  })
}
