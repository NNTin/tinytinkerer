/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EDGE_URL?: string
  readonly VITE_GITHUB_CLIENT_ID?: string
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __BUILD_HASH__: string
