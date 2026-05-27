import { StrictMode, startTransition, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  initializeBrowserApp,
  resolveBrowserShellBootstrapConfig,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { WidgetBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
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
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false

    void initializeBrowserApp(browserApp, browserConfig)
      .then(() => {
        if (!disposed) {
          startTransition(() => {
            setReady(true)
          })
        }
      })
      .catch((nextError: unknown) => {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to start the widget shell.')
        }
      })

    return () => {
      disposed = true
    }
  }, [])

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
