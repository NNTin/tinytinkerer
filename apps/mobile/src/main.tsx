import { StrictMode, startTransition, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  initializeBrowserApp,
  resolveBrowserShellBootstrapConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { MobileBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
const browserConfig = resolveBrowserShellBootstrapConfig({
  baseUrl: import.meta.env.BASE_URL,
  origin: window.location.origin,
  edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
  manifestStartUrl: import.meta.env.BASE_URL,
  githubClientId
})

const queryClient = new QueryClient()
const browserApp = createBrowserApp(browserConfig)

const MobileBootstrap = () => {
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
          setError(nextError instanceof Error ? nextError.message : 'Unable to start the mobile shell.')
        }
      })

    return () => {
      disposed = true
    }
  }, [])

  if (!ready) {
    return <MobileBootScreen {...(error ? { error } : {})} />
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

createRoot(document.getElementById('root')!).render(<MobileBootstrap />)
