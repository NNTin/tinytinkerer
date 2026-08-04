/**
 * The plugin catalogue: the ONE module that knows which concrete plugin packages
 * exist (issue #495).
 *
 * ## Why this package exists
 *
 * `app-browser` used to discover plugins itself, through a Vite
 * `import.meta.glob` over every `packages/plugins/<name>/src/index.ts`. That made
 * the catalogue three things it should not have been:
 *
 * - **bundler-specific.** `import.meta.glob` is a Vite build-time transform with
 *   no webpack equivalent, so the Docusaurus build had to alias the whole module
 *   to a "no plugins" stub. A webpack alias to `[]` is not a composition
 *   boundary; it is the absence of one.
 * - **module-global.** One memoized `Promise<PluginModule[]>` per module, shared
 *   by every `BrowserApp` in the document — while a documentation page holds two
 *   (the global assistant and the shared live-lab app), which must be able to
 *   carry different plugins with independent activation and settings.
 * - **unavoidable.** `app.ts`, `stores/chat-store.ts`, `plugins/use-plugin-modules.ts`
 *   and `human-prompt-host.tsx` all imported that singleton directly, so there
 *   was no seam at which a host could say what it carries.
 *
 * So the catalogue moved out of `app-browser` entirely. `app-browser` now knows
 * only the `PluginModule` contract and receives a loader per app; this package
 * owns the concrete `import()`s, and works identically under Vite and webpack
 * because a literal dynamic import is something both bundlers understand.
 *
 * ## Why a separate package rather than a module in `app-browser`
 *
 * `scripts/check-boundaries.mjs` forbids `app-browser` from importing a concrete
 * `@tinytinkerer/plugin-*` package, statically **or** through a literal dynamic
 * import — and forbids every app from doing so too (a `browser-shell` may depend
 * only on `app-browser`/`ui`; an `integrated-shell` adds `app-shell` and its own
 * stage package). The old glob slipped through only because the checker's import
 * pattern does not match `import.meta.glob`, which is a gap in the check rather
 * than a permission. This package is the one place that rule is opened, and it is
 * opened deliberately and narrowly: a positive rule in the boundary checker lets
 * it import `plugin-*` and `contracts`, and nothing else.
 *
 * ## What stays true from the old design
 *
 * Loading is still best-effort: a module that fails to import, or does not
 * satisfy the `PluginModule` contract, is skipped rather than breaking runtime or
 * settings construction for the plugins that did load.
 *
 * `isPluginModule` comes from `@tinytinkerer/contracts` — the canonical one. The
 * entry-safe duplicate `app-browser` carried for it (issue #441's
 * `plugins/is-plugin-module.ts`) existed because the registry ran in every
 * shell's startup entry, where a static value import of `@tinytinkerer/app-core`
 * would drag that package's whole merged ~123 kB manualChunks bucket onto the
 * static graph. Nothing here is in an entry: every consumer reaches this package
 * through a dynamic `import()` (see the `plugins` option's doc comment in
 * `app-browser/src/app.ts`), so the duplicate is gone and the canonical guard is
 * used directly.
 */
import { isPluginModule, type PluginModule } from '@tinytinkerer/contracts'

/**
 * Every plugin package in the workspace, keyed by its directory name under
 * `packages/plugins/`.
 *
 * Hand-authored rather than generated, and bound to reality by
 * `tests/catalogue-coverage.test.ts`, which reads `packages/plugins/*` from the
 * filesystem and fails — naming this file and the exact line to add — if a
 * package is missing a key here. That keeps the drop-in property the plugin
 * documentation promises without a codegen step: adding a plugin still touches
 * one list, and CI says so rather than leaving the plugin silently unreachable.
 *
 * The keys are DIRECTORY names, not `manifest.id`s. A directory is what the
 * coverage test can see without importing anything, and the two differ (the
 * `plugin-browser-state` directory ships `manifest.id === 'browser-state'`).
 *
 * Each value is a thunk, so naming a subset costs nothing at runtime: only the
 * plugins a host actually asks for are ever fetched, each in its own chunk.
 */
const PLUGIN_LOADERS = {
  'plugin-browser-state': () => import('@tinytinkerer/plugin-browser-state'),
  'plugin-choice-prompt': () => import('@tinytinkerer/plugin-choice-prompt'),
  'plugin-code-exec': () => import('@tinytinkerer/plugin-code-exec'),
  'plugin-context-inspector': () => import('@tinytinkerer/plugin-context-inspector'),
  'plugin-context-usage': () => import('@tinytinkerer/plugin-context-usage'),
  'plugin-event-logger': () => import('@tinytinkerer/plugin-event-logger'),
  'plugin-feedback': () => import('@tinytinkerer/plugin-feedback'),
  'plugin-permissions': () => import('@tinytinkerer/plugin-permissions'),
  'plugin-tool-tree': () => import('@tinytinkerer/plugin-tool-tree'),
  'plugin-web-search': () => import('@tinytinkerer/plugin-web-search')
} satisfies Record<string, () => Promise<unknown>>

/** A plugin package's directory name — the key a host names a subset with. */
export type CataloguePluginName = keyof typeof PLUGIN_LOADERS

/**
 * Every name in the catalogue, sorted, for the coverage test and for a host that
 * wants all of them. Sorted so the order a host sees does not depend on object
 * literal order.
 */
export const CATALOGUE_PLUGIN_NAMES = Object.keys(PLUGIN_LOADERS).sort() as CataloguePluginName[]

/**
 * Load exactly the named plugins.
 *
 * The `readonly` parameter is what lets a host declare its subset as a
 * `const`-asserted tuple and have TypeScript reject a name that is not in the
 * catalogue — which is how a documentation app states an exclusion in a way that
 * fails at compile time if the plugin is renamed out from under it.
 */
export const loadPlugins = async (
  names: readonly CataloguePluginName[]
): Promise<PluginModule[]> => {
  const modules: PluginModule[] = []
  for (const name of names) {
    try {
      const mod = await PLUGIN_LOADERS[name]()
      if (isPluginModule(mod)) {
        modules.push(mod)
      }
    } catch {
      // Optional plugin failed to load — tolerate and skip, so one broken
      // plugin cannot break the host or the plugins beside it.
    }
  }
  return modules
}

/**
 * The full product catalogue — what every TinyTinkerer product shell carries.
 *
 * Named rather than spelled out at each shell, because "all of them" is the
 * product's actual answer and five copies of the list would drift. A host that
 * carries a SUBSET says so explicitly with {@link loadPlugins}; the documentation
 * apps are the only ones that do, and their exclusions are asserted in
 * `apps/docs/src/docs-runtime/__tests__/no-dom-access.test.ts`.
 */
export const loadProductPlugins = (): Promise<PluginModule[]> => loadPlugins(CATALOGUE_PLUGIN_NAMES)
