/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_EDGE_URL?: string
    readonly VITE_GITHUB_CLIENT_ID?: string
    readonly VITE_SENTRY_DSN?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  const __APP_VERSION__: string
  const __BUILD_HASH__: string
}

export {}
