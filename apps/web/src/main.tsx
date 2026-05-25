import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
const githubRedirectUri = `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback`

const browserConfig: BrowserShellConfig = {
  edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
  storageNamespace: 'tinytinkerer',
  authMode: 'hybrid',
  manifestStartUrl: import.meta.env.BASE_URL,
  ...(githubClientId ? { githubClientId } : {}),
  ...(githubClientId ? { githubRedirectUri } : {})
}

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
