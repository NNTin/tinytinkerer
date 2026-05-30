import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  LazyPrivacyPolicyUpdateGate,
  LazyTelemetryConsentGate,
  resolveBrowserShellBootstrapConfig,
  useBrowserAppBootstrap
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { WebBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
const browserConfig = resolveBrowserShellBootstrapConfig({
  baseUrl: import.meta.env.BASE_URL,
  origin: window.location.origin,
  edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
  manifestStartUrl: import.meta.env.BASE_URL,
  githubClientId,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
  appVersion: __APP_VERSION__,
  buildHash: __BUILD_HASH__
})

const queryClient = new QueryClient()
const browserApp = createBrowserApp(browserConfig)

const WebBootstrap = () => {
  const { ready, error } = useBrowserAppBootstrap(browserApp, browserConfig)

  if (!ready) {
    return <WebBootScreen {...(error ? { error } : {})} />
  }

  return (
    <StrictMode>
      <AppBrowserProvider app={browserApp}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Suspense fallback={null}>
            <LazyPrivacyPolicyUpdateGate />
          </Suspense>
          <Suspense fallback={null}>
            <LazyTelemetryConsentGate />
          </Suspense>
        </QueryClientProvider>
      </AppBrowserProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<WebBootstrap />)
