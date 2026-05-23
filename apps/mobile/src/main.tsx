import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  AppBrowserProvider,
  createBrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { router } from './app/router'
import './index.css'

registerSW({ immediate: true })

const githubRedirectUri =
  import.meta.env.VITE_GITHUB_REDIRECT_URI ??
  `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback`

const browserConfig: BrowserShellConfig = {
  edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
  storageNamespace: 'tinytinkerer-mobile',
  authMode: 'hybrid',
  ...(import.meta.env.VITE_GITHUB_CLIENT_ID ? { githubClientId: import.meta.env.VITE_GITHUB_CLIENT_ID } : {}),
  ...(githubRedirectUri ? { githubRedirectUri } : {})
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
