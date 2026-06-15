// Build-time defines injected by each consuming app's vite config. Declared
// here so app-browser typechecks standalone; the apps redeclare them in their
// own `vite-env.d.ts`, and TypeScript merges the identical ambient globals.
declare const __APP_VERSION__: string
declare const __BUILD_HASH__: string
