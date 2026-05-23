import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initializeBrowserShell, useAuthStore, useSettingsStore } from '@tinytinkerer/app-browser'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

const queryClient = new QueryClient()

initializeBrowserShell({
  edgeBaseUrl: import.meta.env.VITE_EDGE_URL ?? '',
  storageNamespace: 'tinytinkerer-web',
  authMode: 'hybrid',
  githubClientId: import.meta.env.VITE_GITHUB_CLIENT_ID,
  githubRedirectUri: import.meta.env.VITE_GITHUB_REDIRECT_URI
})

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
