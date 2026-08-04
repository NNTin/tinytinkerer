import type { PluginModule } from '@tinytinkerer/app-core'
import type { PluginCatalogue } from '../src/app'

/**
 * A plugin catalogue for tests (issue #495).
 *
 * `createBrowserApp` requires a catalogue, deliberately and with no default, so
 * every test that builds an app has to supply one. Most of them do not care:
 * before #495 they wrote `vi.mock('../src/plugins/registry.js', () => ({
 * loadPluginModules: vi.fn().mockResolvedValue([]) }))` — thirteen copies of a
 * module mock whose only purpose was to stop a Vite-only `import.meta.glob` from
 * evaluating under vitest. That mock is gone with the module, and replacing it
 * with thirteen copies of an inline arrow would repeat the same mistake in a new
 * shape.
 *
 * So: `noPlugins` for the suites that never cared (document globals, branding,
 * the human-prompt suites, bootstrap), and `pluginsFor([...])` for the few that
 * are genuinely about plugin-derived behaviour (the context gauge, the inspector,
 * the tool tree). Naming which one a suite uses says, at the call site, whether
 * plugins are part of what it is testing.
 */

/**
 * An app that carries no plugins.
 *
 * A real production configuration, not only a test shortcut: it is what a
 * documentation live lab looked like before this issue, and what any host that
 * declines the catalogue gets.
 */
export const noPlugins: PluginCatalogue = () => Promise.resolve([])

/**
 * An app carrying exactly these modules.
 *
 * Takes already-built `PluginModule`s rather than catalogue names so a suite can
 * pass a purpose-built stub — most of these tests assert on a manifest field or a
 * descriptor and have no use for a real plugin package, which they could not
 * import anyway (the boundary checker forbids `app-browser` naming one).
 */
export const pluginsFor =
  (modules: readonly PluginModule[]): PluginCatalogue =>
  () =>
    Promise.resolve([...modules])
