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
import { resolveWidgetGitHubRedirectUri } from './runtime-config'
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
  manifestStartUrl: import.meta.env.BASE_URL,
  hostToken: hostConfig.hostToken ?? null
}

const githubClientId = hostConfig.githubClientId ?? getEnvValue('VITE_GITHUB_CLIENT_ID')
const githubRedirectUri = resolveWidgetGitHubRedirectUri(
  hostConfig,
  githubClientId,
  import.meta.env.BASE_URL,
  window.location.origin
)

const browserConfig: BrowserShellConfig = {
  ...widgetConfigBase,
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
