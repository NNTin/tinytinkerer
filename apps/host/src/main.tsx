import {
  BrowserAppShell,
  createBrowserApp,
  resolveBrowserShellBootstrapConfig
} from '@tinytinkerer/app-browser'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { RootBootScreen } from './loading-screen'
import { hostRouter } from './router'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

const readEnvValue = (key: string): string | undefined => {
  const value = (import.meta.env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

// The root composition is first-party (no embedder), so there is no injected window
// config: one config, one BrowserApp, one session shared by all three panes.
const config = resolveBrowserShellBootstrapConfig({
  baseUrl: import.meta.env.BASE_URL,
  origin: window.location.origin,
  manifestStartUrl: import.meta.env.BASE_URL,
  edgeBaseUrl: readEnvValue('VITE_EDGE_URL') ?? '',
  githubClientId: readEnvValue('VITE_GITHUB_CLIENT_ID'),
  sentryDsn: readEnvValue('VITE_SENTRY_DSN'),
  sentryEnvironment: readEnvValue('VITE_SENTRY_ENVIRONMENT'),
  appVersion: __APP_VERSION__,
  buildHash: __BUILD_HASH__
})

// The host compositor carries the full product catalogue, like every other
// product surface (issue #495). It does NOT go through `createBrowserShellRoot`
// — it mounts `BrowserAppShell` itself, below — so it names its own catalogue
// here; that is exactly why `plugins` is required on `createBrowserApp` rather
// than defaulted at the shell-root helper, where this call site would have been
// silently skipped and the compositor would have lost every plugin.
//
// Reached through a dynamic import() so the per-plugin map stays out of this
// entry chunk — see PluginCatalogue's doc comment in app-browser.
const browserApp = createBrowserApp(config, {
  plugins: () => import('@tinytinkerer/catalogue').then((m) => m.loadProductPlugins())
})

// The RouterProvider renders INSIDE BrowserAppShell (not the other way around):
// RootComposition and the OAuth callback page both consume the app context
// BrowserAppShell provides, so they must be its descendants, same as
// createBrowserShellRoot wires the shell/canvas routers.
createRoot(document.getElementById('root')!).render(
  <BrowserAppShell app={browserApp} config={config} BootScreen={RootBootScreen}>
    <RouterProvider router={hostRouter} />
  </BrowserAppShell>
)
