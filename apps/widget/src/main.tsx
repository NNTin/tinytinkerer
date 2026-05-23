import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  initializeBrowserShell,
  useAuthStore,
  useSettingsStore,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

const widgetConfig: BrowserShellConfig = {
  edgeBaseUrl: window.__TINYTINKERER_WIDGET_CONFIG__?.edgeBaseUrl ?? import.meta.env.VITE_EDGE_URL ?? '',
  storageNamespace:
    window.__TINYTINKERER_WIDGET_CONFIG__?.storageNamespace ?? 'tinytinkerer-widget',
  authMode: window.__TINYTINKERER_WIDGET_CONFIG__?.authMode ?? 'hybrid',
  hostToken: window.__TINYTINKERER_WIDGET_CONFIG__?.hostToken ?? null,
  githubClientId:
    window.__TINYTINKERER_WIDGET_CONFIG__?.githubClientId ?? import.meta.env.VITE_GITHUB_CLIENT_ID,
  githubRedirectUri:
    window.__TINYTINKERER_WIDGET_CONFIG__?.githubRedirectUri ??
    import.meta.env.VITE_GITHUB_REDIRECT_URI
}

initializeBrowserShell(widgetConfig)

const queryClient = new QueryClient()

void Promise.all([
  useAuthStore.getState().initialize(),
  useSettingsStore.getState().initialize()
]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
})
