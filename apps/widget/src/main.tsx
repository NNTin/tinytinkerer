import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  bootstrapBrowserShell,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

const hostConfig: BrowserShellConfig = window.__TINYTINKERER_WIDGET_CONFIG__ ?? {}

const getEnvValue = (
  key: 'VITE_EDGE_URL' | 'VITE_GITHUB_CLIENT_ID' | 'VITE_GITHUB_REDIRECT_URI'
): string | undefined => {
  const value = (import.meta.env as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const widgetConfigBase: BrowserShellConfig = {
  edgeBaseUrl: hostConfig.edgeBaseUrl ?? getEnvValue('VITE_EDGE_URL') ?? '',
  storageNamespace: hostConfig.storageNamespace ?? 'tinytinkerer-widget',
  authMode: hostConfig.authMode ?? 'hybrid',
  hostToken: hostConfig.hostToken ?? null
}

const githubClientId = hostConfig.githubClientId ?? getEnvValue('VITE_GITHUB_CLIENT_ID')
const githubRedirectUri =
  hostConfig.githubRedirectUri ?? getEnvValue('VITE_GITHUB_REDIRECT_URI')

const browserConfig: BrowserShellConfig = {
  ...widgetConfigBase,
  ...(githubClientId ? { githubClientId } : {}),
  ...(githubRedirectUri ? { githubRedirectUri } : {})
}

const queryClient = new QueryClient()

void bootstrapBrowserShell(browserConfig).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
})
