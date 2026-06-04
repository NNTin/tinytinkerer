import { isPluginModule, type PluginModule } from '@tinytinkerer/app-core'

// Optional plugins are discovered from the workspace `packages/plugins/*`
// directory at build time via Vite's import.meta.glob. This keeps app-browser
// free of any static dependency on a concrete plugin package: if a plugin is
// absent the glob simply yields no entry, so the host still compiles and runs.
//
// Loading is best-effort and tolerates missing/broken plugins — a module that
// fails to import, or does not satisfy the PluginModule contract, is skipped so
// an optional plugin can never break runtime or settings construction.
const pluginModuleLoaders = import.meta.glob<unknown>(
  '../../../../plugins/*/src/index.ts'
)

let cache: Promise<PluginModule[]> | undefined

// Discover and load every available plugin module once (result cached). Returns
// only modules that match the PluginModule contract.
export const loadPluginModules = (): Promise<PluginModule[]> => {
  cache ??= (async () => {
    const modules: PluginModule[] = []
    for (const load of Object.values(pluginModuleLoaders)) {
      try {
        const mod = await load()
        if (isPluginModule(mod)) {
          modules.push(mod)
        }
      } catch {
        // Optional plugin failed to load — tolerate and skip.
      }
    }
    return modules
  })()
  return cache
}

// Test seam: drop the memoized discovery so a test can re-run loading against a
// freshly stubbed module set.
export const resetPluginModuleCache = (): void => {
  cache = undefined
}
