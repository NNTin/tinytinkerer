import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppBrowserProvider, createBrowserApp, resolveBrowserShellBootstrapConfig } from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
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

void createBrowserApp(browserConfig).then((browserApp) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppBrowserProvider app={browserApp}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppBrowserProvider>
    </StrictMode>
  )
})
