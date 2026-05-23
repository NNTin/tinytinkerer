import {
  createContext,
  createElement,
  useContext,
  type PropsWithChildren,
  type ReactNode
} from 'react'
import { useStore } from 'zustand'
import type { BrowserShellConfig } from './config'
import { createBrowserShell, type BrowserShell } from './shell'
import { createAuthStore, type AuthState, type AuthStore } from './stores/auth-store'
import { createChatStore, type ChatState, type ChatStore } from './stores/chat-store'
import {
  createSettingsStore,
  type SettingsState,
  type SettingsStore
} from './stores/settings-store'
import { createStatusStore, type StatusState, type StatusStore } from './stores/status-store'

export type BrowserApp = {
  shell: BrowserShell
  stores: {
    auth: AuthStore
    chat: ChatStore
    settings: SettingsStore
    status: StatusStore
  }
}

const BrowserAppContext = createContext<BrowserApp | undefined>(undefined)

const browserAppError = (): Error =>
  new Error('Browser app has not been created. Call createBrowserApp() and mount <AppBrowserProvider>.')

const requireBrowserApp = (app: BrowserApp | undefined): BrowserApp => {
  if (!app) {
    throw browserAppError()
  }

  return app
}

export const createBrowserApp = async (config: BrowserShellConfig): Promise<BrowserApp> => {
  const shell = createBrowserShell(config)
  const { applyBrandMetadata } = await import('./branding')
  applyBrandMetadata()
  const auth = createAuthStore(shell)
  const settings = createSettingsStore(shell)
  const status = createStatusStore(shell)
  const chat = createChatStore({
    shell,
    authStore: auth,
    settingsStore: settings,
    statusStore: status
  })

  const app: BrowserApp = {
    shell,
    stores: {
      auth,
      chat,
      settings,
      status
    }
  }

  await Promise.all([
    auth.getState().initialize(),
    chat.getState().initialize(),
    settings.getState().initialize(),
    status.getState().initialize()
  ])

  return app
}

export const AppBrowserProvider = ({
  app,
  children
}: PropsWithChildren<{ app: BrowserApp }>): ReactNode =>
  createElement(BrowserAppContext.Provider, { value: app }, children)

export const useBrowserApp = (): BrowserApp => requireBrowserApp(useContext(BrowserAppContext))

export const useAuthStore = <T>(selector: (state: AuthState) => T): T =>
  useStore(useBrowserApp().stores.auth, selector)

export const useChatStore = <T>(selector: (state: ChatState) => T): T =>
  useStore(useBrowserApp().stores.chat, selector)

export const useSettingsStore = <T>(selector: (state: SettingsState) => T): T =>
  useStore(useBrowserApp().stores.settings, selector)

export const useStatusStore = <T>(selector: (state: StatusState) => T): T =>
  useStore(useBrowserApp().stores.status, selector)
