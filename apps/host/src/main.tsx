import {
  BrowserAppShell,
  createBrowserApp,
  resolveBrowserShellBootstrapConfig
} from '@tinytinkerer/app-browser'
import { createRoot } from 'react-dom/client'
import { RootBootScreen } from './loading-screen'
import { RootComposition } from './root-composition'
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

const browserApp = createBrowserApp(config)

createRoot(document.getElementById('root')!).render(
  <BrowserAppShell app={browserApp} config={config} BootScreen={RootBootScreen} mountGlobals>
    <RootComposition />
  </BrowserAppShell>
)
