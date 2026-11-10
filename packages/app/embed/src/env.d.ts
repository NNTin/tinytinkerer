// Build-time constants app-browser's sources read (see app-browser's own
// env.d.ts). vite.config.ts defines them for this bundle; declared here so the
// compiler — this package's typecheck and scripts/build-types.mjs — sees them.
// Ambient only: nothing in the published declarations references them.
declare const __APP_VERSION__: string
declare const __BUILD_HASH__: string
