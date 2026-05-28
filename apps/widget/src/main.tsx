import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  resolveBrowserShellBootstrapConfig,
  useBrowserAppBootstrap,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { WidgetBootScreen } from './app/loading-screen'
import './index.css'

// The embedding page is fully trusted — it provides hostToken and other config intentionally.
// Freeze immediately to prevent accidental mutation before values are consumed below.
const hostConfig: BrowserShellConfig = Object.freeze(window.__TINYTINKERER_WIDGET_CONFIG__ ?? {})

const getEnvValue = (
  key: 'VITE_EDGE_URL' | 'VITE_GITHUB_CLIENT_ID'
): string | undefined => {
  const value = (import.meta.env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const widgetConfigBase: BrowserShellConfig = {
  edgeBaseUrl: hostConfig.edgeBaseUrl ?? getEnvValue('VITE_EDGE_URL') ?? '',
  storageNamespace: hostConfig.storageNamespace ?? 'tinytinkerer',
  authMode: hostConfig.authMode ?? 'hybrid',
  hostToken: hostConfig.hostToken ?? null
}

const githubClientId = hostConfig.githubClientId ?? getEnvValue('VITE_GITHUB_CLIENT_ID')
const browserConfig = resolveBrowserShellBootstrapConfig({
  ...widgetConfigBase,
  baseUrl: import.meta.env.BASE_URL,
  origin: window.location.origin,
  manifestStartUrl: import.meta.env.BASE_URL,
  githubClientId,
  githubRedirectUri: hostConfig.githubRedirectUri
})

const queryClient = new QueryClient()
const browserApp = createBrowserApp(browserConfig)

const WidgetBootstrap = () => {
  const { ready, error } = useBrowserAppBootstrap(browserApp, browserConfig)

  if (!ready) {
    return <WidgetBootScreen {...(error ? { error } : {})} />
  }

  return (
    <StrictMode>
      <AppBrowserProvider app={browserApp}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppBrowserProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<WidgetBootstrap />)
