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

const getEnvValue = (
  key: 'VITE_EDGE_URL' | 'VITE_GITHUB_CLIENT_ID'
): string | undefined => {
  const value = (import.meta.env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const githubRedirectUri = `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback`
const githubClientId = getEnvValue('VITE_GITHUB_CLIENT_ID')

const browserConfig: BrowserShellConfig = {
  edgeBaseUrl: getEnvValue('VITE_EDGE_URL') ?? '',
  storageNamespace: 'tinytinkerer',
  authMode: 'hybrid',
  ...(githubClientId ? { githubClientId } : {}),
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
