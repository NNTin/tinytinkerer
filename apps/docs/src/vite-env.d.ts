/// <reference types="vite/client" />

// The LiveLab framework (issue #451) statically imports @tinytinkerer/app-browser's
// public barrel from client-runtime.tsx, so `tsc` type-checks that package's whole
// module graph as part of this app's program — including its own `vite/client`
// (import.meta.env / import.meta.glob) and build-time-define usages. Docs itself is
// a Docusaurus/webpack build, not Vite, but these ambient types are needed purely so
// the shared TS program covering both packages resolves; nothing here is emitted or
// used by Docusaurus's own bundler.
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
