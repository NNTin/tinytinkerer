import type { ChatRuntimeFactory } from '@tinytinkerer/app-core'
import type { BrowserShell } from '../shell'
import type { AuthStore } from '../stores/auth-store'
import type { SettingsStore } from '../stores/settings-store'
import { isSearchReady, type StatusStore } from '../stores/status-store'
import { createRuntime } from './create-runtime'

export const createBrowserRuntimeFactory = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  statusStore: StatusStore
}): ChatRuntimeFactory => ({
  create: () =>
    createRuntime({
      baseUrl: options.shell.config.edgeBaseUrl,
      searchEnabled:
        options.settingsStore.getState().searchEnabled &&
        isSearchReady(options.statusStore.getState()),
      getToken: () => options.authStore.getState().token,
      getModel: () => options.settingsStore.getState().selectedModel
    })
})
