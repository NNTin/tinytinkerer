/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_EDGE_URL?: string
    readonly VITE_GITHUB_CLIENT_ID?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

export {}
