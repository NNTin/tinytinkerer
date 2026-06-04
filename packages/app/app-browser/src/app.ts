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
import { applyBrandMetadata } from './branding'
import { createAuthStore, type AuthState, type AuthStore } from './stores/auth-store'
import { createChatStore, type ChatState, type ChatStore } from './stores/chat-store'
import {
  createSettingsStore,
  type SettingsState,
  type SettingsStore
} from './stores/settings-store'
import { createStatusStore, type StatusState, type StatusStore } from './stores/status-store'
import {
  captureTelemetryException,
  configureTelemetry,
  setTelemetryConsent
} from './telemetry/telemetry'

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

export const createBrowserApp = (config: BrowserShellConfig): BrowserApp => {
  const shell = createBrowserShell(config)
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

  return app
}

export const initializeBrowserApp = async (
  app: BrowserApp,
  config: BrowserShellConfig = {}
): Promise<void> => {
  applyBrandMetadata(config)
  const { shell } = app
  // Route content render-boundary failures to Sentry. Imported dynamically so
  // the heavy content-react chunk stays out of the startup entry bundle (it is
  // lazily loaded when content first renders — which is also the only point a
  // render error can occur, so registering asynchronously here is safe). The
  // sink no-ops until telemetry is initialized (consent granted, DSN set,
  // non-dev environment), mirroring how the SDK's global handlers only fire
  // after init. Component stack goes in context; the per-message fingerprint
  // keeps distinct render failures as distinct issues.
  void import('@tinytinkerer/content-react').then(({ setContentRenderErrorReporter }) => {
    setContentRenderErrorReporter((error, info) => {
      captureTelemetryException(error, {
        level: 'error',
        tags: { source: 'content-render' },
        ...(info.componentStack
          ? { contexts: { react: { componentStack: info.componentStack } } }
          : {}),
        fingerprint: ['content-render', error.message]
      })
    })
  })
  await configureTelemetry(
    {
      ...(shell.config.sentryDsn ? { dsn: shell.config.sentryDsn } : {}),
      environment: shell.config.sentryEnvironment,
      appVersion: shell.config.appVersion,
      buildHash: shell.config.buildHash
    },
    shell.preferences
  )
  await Promise.all([
    app.stores.auth.getState().initialize(),
    app.stores.settings.getState().initialize()
  ])
  // Restore Sentry for returning users who previously opted in.
  if (app.stores.settings.getState().telemetryEnabled) {
    await setTelemetryConsent(true)
  }
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

export const useOptionalBrowserApp = (): BrowserApp | undefined => useContext(BrowserAppContext)
