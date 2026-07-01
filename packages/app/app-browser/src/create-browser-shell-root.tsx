import type { ComponentProps, ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { createBrowserApp } from './app'
import { BrowserAppShell } from './browser-app-shell'
import { resolveBrowserShellBootstrapConfig } from './config'
import { registerPwa } from './register-pwa'
import type { BrowserShellConfig } from './config'
import type { Tool } from '@tinytinkerer/app-core'

declare global {
  interface Window {
    // Shell-agnostic embedding contract. Any embedder (today only the widget
    // host) sets this before the shell entry script runs; web and mobile leave
    // it unset. Declared here — beside the resolver that reads it — so the type
    // travels with the shared bootstrap into every consuming shell.
    __TINYTINKERER_SHELL_CONFIG__?: BrowserShellConfig
  }
}

type ShellRouter = ComponentProps<typeof RouterProvider>['router']

export type BrowserShellBootScreenProps = { error?: string }

export type CreateBrowserShellRootOptions = {
  router: ShellRouter
  BootScreen: ComponentType<BrowserShellBootScreenProps>
  // App-local, always-on chat tools the app contributes to its own runtime (the
  // only per-app runtime input — there is still no shell id or onInit hook). A
  // harness shell (e.g. the canvas shell) passes its app-specific verbs
  // here; web/mobile/widget omit it. Threaded straight to createBrowserApp → chat
  // store → runtime.
  appTools?: Tool<unknown, unknown>[]
}

// Env values are read through an untyped index access because each shell's
// `import.meta.env` carries its own `VITE_*` keys; the shared resolver only
// needs the common subset and tolerates absent keys.
const readEnvValue = (key: string): string | undefined => {
  const value = (import.meta.env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The single bootstrap shared by every browser shell. It owns config
 * resolution, the provider/Suspense/gate tree, the bootstrap hook, PWA
 * registration, and the `createRoot().render()`.
 *
 * The only per-shell inputs are the `router` (content) and `BootScreen`
 * (visual). Everything else is uniform — there is no shell id, no `configSource`
 * flag, and no `onInit`/`beforeRender` escape hatch. Config comes from one
 * shell-agnostic window key layered over env and defaults; PWA registration
 * always runs and no-ops where the build emitted no service worker.
 */
export const createBrowserShellRoot = ({
  router,
  BootScreen,
  appTools
}: CreateBrowserShellRootOptions): void => {
  // Shell-agnostic embedding contract: every shell reads the same window key.
  // Empty for web/mobile, populated by widget embedders. The embedding page is
  // fully trusted — it provides hostToken and other config intentionally —
  // so freeze immediately to prevent accidental mutation before consumption.
  const injected = Object.freeze(window.__TINYTINKERER_SHELL_CONFIG__ ?? {})

  const browserConfig = resolveBrowserShellBootstrapConfig({
    baseUrl: import.meta.env.BASE_URL,
    origin: window.location.origin,
    manifestStartUrl: import.meta.env.BASE_URL,
    edgeBaseUrl: injected.edgeBaseUrl ?? readEnvValue('VITE_EDGE_URL') ?? '',
    storageNamespace: injected.storageNamespace,
    authMode: injected.authMode,
    hostToken: injected.hostToken ?? null,
    githubClientId: injected.githubClientId ?? readEnvValue('VITE_GITHUB_CLIENT_ID'),
    githubRedirectUri: injected.githubRedirectUri,
    theme: injected.theme,
    sentryDsn: readEnvValue('VITE_SENTRY_DSN'),
    sentryEnvironment: readEnvValue('VITE_SENTRY_ENVIRONMENT'),
    appVersion: __APP_VERSION__,
    buildHash: __BUILD_HASH__
  })

  const browserApp = createBrowserApp(browserConfig, appTools ? { appTools } : {})

  // Register the service worker and start update checks independently of the
  // React render, so a shell that ships one (mobile today) stays registered
  // even while the boot screen is showing. No-op where no SW was emitted.
  registerPwa()

  createRoot(document.getElementById('root')!).render(
    <BrowserAppShell app={browserApp} config={browserConfig} BootScreen={BootScreen}>
      <RouterProvider router={router} />
    </BrowserAppShell>
  )
}
