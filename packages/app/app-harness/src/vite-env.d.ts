/// <reference types="vite/client" />

// app-harness pulls in @tinytinkerer/app-browser source through its package
// `exports`, so it needs the same Vite ambient types app-browser relies on
// (import.meta.env / glob, the build-time defines, and `?url` module imports).
// These mirror the apps' own vite-env.d.ts; TypeScript merges the identical
// ambient globals.
interface ImportMetaEnv {
  readonly VITE_EDGE_URL?: string
  readonly VITE_GITHUB_CLIENT_ID?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
declare const __BUILD_HASH__: string
