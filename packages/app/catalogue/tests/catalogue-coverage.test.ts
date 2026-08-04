// @vitest-environment node
/**
 * The catalogue covers every plugin package in the workspace (issue #495).
 *
 * ## Why this test is the whole design
 *
 * Discovery used to be a Vite `import.meta.glob`, which gave the plugin system a
 * property the documentation promises in as many words: adding a package under
 * `packages/plugins/` is enough, and no host code changes
 * (`docs/plugins-and-tools/build-a-plugin.md` step 4 tells a reader their new
 * plugin "should appear in the list with no other change"). A hand-authored map
 * of concrete `import()`s cannot give that property on its own — someone will add
 * a plugin and forget the line.
 *
 * This test restores the guarantee without codegen: the map is bound to the
 * filesystem, and forgetting the line fails here, in seconds, with a message that
 * names the file and the exact entry to add. Generating the module instead would
 * have bought the same guarantee for the price of a turbo task, a staleness
 * check, and — less obviously — an exemption from the boundary checker's source
 * rules, which skip `*.generated.*` files entirely.
 *
 * ## Why it compares keys, not loaded modules
 *
 * The thing being guarded is "did someone forget to add a line", and the keys
 * answer that. Invoking the thunks would pull every plugin module into a unit
 * test for no additional guarantee, and would make this test depend on bare
 * specifier resolution that only the bundlers need.
 *
 * ## What this test does NOT guarantee
 *
 * That a catalogued plugin reaches a reader. A plugin can be in this map and
 * still be missing from the deployed Settings panel — a build or composition
 * fault this source-level check cannot see. That is
 * `packages/e2e/tests/docs/plugin-matrix.e2e.ts`'s job, which derives its
 * expectations from the filesystem INDEPENDENTLY (see
 * `packages/e2e/fixtures/discover-plugins.ts`) rather than from this map. The
 * independence is the point: a matrix that took its expectations from the
 * catalogue would stop expecting a plugin the catalogue dropped, and stay green
 * while the product silently lost it.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATALOGUE_PLUGIN_NAMES } from '../src/index'

/** `packages/plugins`, resolved from this file (`packages/app/catalogue/tests`). */
const PLUGINS_DIR = fileURLToPath(new URL('../../../plugins', import.meta.url))

/**
 * Every plugin package directory on disk.
 *
 * A directory without a `src/index.ts` is skipped rather than failing, mirroring
 * the loader's own tolerate-missing behaviour: an in-progress package that has
 * not exported a module yet is not a catalogue gap.
 */
const pluginDirectoriesOnDisk = (): string[] =>
  readdirSync(PLUGINS_DIR)
    .filter((dir) => existsSync(join(PLUGINS_DIR, dir, 'src', 'index.ts')))
    .sort()

describe('the catalogue covers every plugin package', () => {
  it('names every plugin directory on disk, and no directory that is absent', () => {
    const onDisk = pluginDirectoriesOnDisk()
    // Compared as plain strings in both directions: a directory on disk that the
    // catalogue does not name is by definition not a `CataloguePluginName`, which
    // is the whole thing being detected.
    const catalogued: readonly string[] = CATALOGUE_PLUGIN_NAMES
    const missing = onDisk.filter((dir) => !catalogued.includes(dir))
    const stale = catalogued.filter((name) => !onDisk.includes(name))

    expect(
      missing,
      missing.length === 0
        ? ''
        : `packages/app/catalogue/src/index.ts is missing ${missing.length} plugin(s). ` +
            `Add to PLUGIN_LOADERS:\n` +
            missing.map((dir) => `  '${dir}': () => import('@tinytinkerer/${dir}'),`).join('\n') +
            `\n…and the matching "@tinytinkerer/${missing[0]}": "workspace:*" dependency in ` +
            `packages/app/catalogue/package.json.`
    ).toEqual([])

    expect(
      stale,
      stale.length === 0
        ? ''
        : `packages/app/catalogue/src/index.ts names ${stale.join(', ')}, which no longer ` +
            `exists under packages/plugins/. Remove the entry and its package.json dependency.`
    ).toEqual([])
  })

  it('sorts the exported names, so a host never depends on literal order', () => {
    expect(CATALOGUE_PLUGIN_NAMES).toEqual([...CATALOGUE_PLUGIN_NAMES].sort())
  })
})
