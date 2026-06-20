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
  createInspectorStore,
  type InspectorState,
  type InspectorStore
} from './stores/inspector-store'
import {
  captureTelemetryException,
  configureTelemetry,
  fingerprintMessage,
  setTelemetryConsent
} from './telemetry/telemetry'
import type { ContentRenderErrorInfo } from '@tinytinkerer/content-react'

export type BrowserApp = {
  shell: BrowserShell
  stores: {
    auth: AuthStore
    chat: ChatStore
    settings: SettingsStore
    status: StatusStore
    inspector: InspectorStore
  }
}

const BrowserAppContext = createContext<BrowserApp | undefined>(undefined)

const browserAppError = (): Error =>
  new Error(
    'Browser app has not been created. Call createBrowserApp() and mount <AppBrowserProvider>.'
  )

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
  const inspector = createInspectorStore()
  const chat = createChatStore({
    shell,
    authStore: auth,
    settingsStore: settings,
    inspectorStore: inspector
  })

  const app: BrowserApp = {
    shell,
    stores: {
      auth,
      chat,
      settings,
      status,
      inspector
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
  // Route content render failures (React boundary, runtime per-node catch, and
  // failed lazy plugin loads) to Sentry. The sink no-ops until telemetry is
  // initialized (consent granted, DSN set, non-dev environment), mirroring how
  // the SDK's global handlers only fire after init. Component stack goes in
  // context; the reason + plugin/node fingerprint keeps distinct render failures
  // as distinct issues rather than collapsing under the shared frame.
  const reportContentRender = (error: Error, info: ContentRenderErrorInfo): void => {
    captureTelemetryException(error, {
      level: 'error',
      tags: {
        source: 'content-render',
        ...(info.reason ? { content_render_reason: info.reason } : {}),
        ...(info.nodeType ? { content_node_type: info.nodeType } : {}),
        ...(info.pluginId ? { content_plugin: info.pluginId } : {})
      },
      ...(info.componentStack
        ? { contexts: { react: { componentStack: info.componentStack } } }
        : {}),
      fingerprint: [
        'content-render',
        info.reason ?? 'render',
        info.pluginId ?? info.nodeType ?? 'unknown',
        fingerprintMessage(error.message)
      ]
    })
  }
  // content-react is imported dynamically so its heavy chunk stays out of the
  // startup entry bundle (cross-package subpath imports are forbidden, so we
  // cannot reach the leaf reporter module on its own). The import is kicked off
  // here and awaited at the end of initialization — overlapping store init so it
  // adds little latency — so this function only resolves once the sink is
  // registered. That closes the race where content rendered before a
  // fire-and-forget registration would silently drop its error.
  const reporterReady = import('@tinytinkerer/content-react')
    .then(({ setContentRenderErrorReporter }) => {
      setContentRenderErrorReporter(reportContentRender)
    })
    .catch((error: unknown) => {
      // Telemetry wiring must never break startup; surface the failure in dev
      // and continue without the content-render sink.
      console.error('Failed to wire content render telemetry', error)
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
  // Ensure the content-render sink is registered before initialization resolves
  // (and thus before the UI is marked ready) so no early render slips past it.
  await reporterReady
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

export const useInspectorStore = <T>(selector: (state: InspectorState) => T): T =>
  useStore(useBrowserApp().stores.inspector, selector)

export const useOptionalBrowserApp = (): BrowserApp | undefined => useContext(BrowserAppContext)
