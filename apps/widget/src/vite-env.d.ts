/* eslint-disable @typescript-eslint/no-unused-vars */
/// <reference types="vite/client" />

type WidgetConfig = {
  edgeBaseUrl?: string
  storageNamespace?: string
  authMode?: 'oauth' | 'host-token' | 'hybrid'
  hostToken?: string | null
  githubClientId?: string
  githubRedirectUri?: string
}

declare global {
  interface Window {
    __TINYTINKERER_WIDGET_CONFIG__?: WidgetConfig
  }
}

interface ImportMetaEnv {
  readonly VITE_EDGE_URL?: string
  readonly VITE_GITHUB_CLIENT_ID?: string
}

export {}
