// Entry-safe duplicate of `@tinytinkerer/contracts`' `isPluginModule` (issue
// #441). registry.ts runs at startup (it seeds the plugin discovery glob), so
// it must not statically import a VALUE from `@tinytinkerer/app-core`: that
// package is bucketed into the same manualChunks output as agent-core and
// contracts (see scripts/browser-shell-chunks.mjs), and a static import from
// any one of them drags the whole merged ~123 kB chunk onto the entry's
// static graph — the exact chunk `loadCoreModule()` elsewhere loads lazily.
// Keep this logic identical to packages/shared/contracts/src/plugins.ts;
// is-plugin-module.test.ts asserts the two never drift.
//
// `import type` is erased at compile time, so pulling the PluginModule TYPE
// from app-core is free — only a VALUE import would create the static chunk
// edge this module exists to avoid.
import type { PluginModule } from '@tinytinkerer/app-core'

export const isPluginModule = (value: unknown): value is PluginModule => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { manifest?: unknown; createPlugin?: unknown }
  if (typeof candidate.createPlugin !== 'function') {
    return false
  }
  const manifest = candidate.manifest
  if (typeof manifest !== 'object' || manifest === null) {
    return false
  }
  const m = manifest as { id?: unknown; label?: unknown; description?: unknown }
  return (
    typeof m.id === 'string' && typeof m.label === 'string' && typeof m.description === 'string'
  )
}
