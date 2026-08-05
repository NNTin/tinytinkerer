import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Type-only (erased at runtime). The e2e package declares no workspace deps and
// reaches contracts by relative path — the same convention fixtures/mock-litellm.ts
// uses for the edge worker — so node never resolves a `@tinytinkerer/*` specifier
// from this file. Each plugin package DOES depend on @tinytinkerer/contracts, so the
// dynamic `import()` of a plugin's own module below resolves it from that package.
import type { PluginManifest } from '../../shared/contracts/src/index'

// =============================================================================
// Node-side plugin discovery for the e2e plugin matrix (issue #268).
// =============================================================================
//
// The product's plugins are named in one place — `@tinytinkerer/catalogue`'s
// `PLUGIN_LOADERS`, one literal dynamic import per package (issue #495). This
// matrix deliberately does NOT read that map. It re-derives the plugin set
// INDEPENDENTLY, node-side: it enumerates the `packages/plugins/*` directories
// from the filesystem and reads each package's exported `manifest`. So a newly
// added plugin package enters the test matrix with ZERO edits to the spec, and
// — the reason the independence matters — a plugin DROPPED from the catalogue
// fails here instead of quietly lowering the bar, which is what a matrix reading
// its own expectations out of the catalogue would do.
//
// (Until #495 the host discovered plugins through a Vite `import.meta.glob` in
// `app-browser/src/plugins/registry.ts`, and this comment described re-deriving
// the glob's set. That module is gone: the glob had no webpack equivalent, so
// the Docusaurus build had to alias it away entirely. The technique here is
// unchanged and the independence argument is now the stronger reason for it.)
//
// We read the manifest by importing the package entry module (not by parsing
// source), so the matrix uses the SAME `manifest.id` / `manifest.label` the app
// renders — keeping the toggle labels and activation ids in lock-step with the
// plugin, never a hand-maintained copy. Each plugin's `src/index.ts` imports
// only from `@tinytinkerer/contracts` (enforced by scripts/check-boundaries.mjs),
// so importing it node-side pulls in no browser/React code.
// =============================================================================

// `packages/plugins`, resolved from this file (packages/e2e/fixtures).
const PLUGINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins')

export type DiscoveredPlugin = {
  /** Directory name under packages/plugins (e.g. `plugin-web-search`). */
  dir: string
  /** Activation key / denylist key — `manifest.id` (e.g. `web-search`). */
  id: string
  /** Settings toggle label — `manifest.label`, the exact `enablePlugin` target. */
  label: string
  /** Whether the plugin ships enabled out-of-the-box (`manifest.defaultEnabled`). */
  defaultEnabled: boolean
}

// Best-effort runtime guard for a discovered module's `manifest`, mirroring the
// fields the host's `isPluginModule` validates (we re-check here instead of
// importing it to keep this file free of a `@tinytinkerer/*` runtime specifier).
const hasManifest = (mod: unknown): mod is { manifest: PluginManifest } => {
  const manifest = (mod as { manifest?: unknown } | null)?.manifest
  if (typeof manifest !== 'object' || manifest === null) return false
  const m = manifest as { id?: unknown; label?: unknown }
  return typeof m.id === 'string' && typeof m.label === 'string'
}

// Enumerate every plugin package under packages/plugins and read its manifest.
// Mirrors the host's best-effort discovery: a directory without a conforming
// `src/index.ts` module is skipped rather than failing collection, so a malformed
// or in-progress plugin can never break the whole matrix. Sorted by id for a
// stable, deterministic test order under `workers: 1`.
export const discoverPlugins = async (): Promise<DiscoveredPlugin[]> => {
  const plugins: DiscoveredPlugin[] = []
  for (const dir of readdirSync(PLUGINS_DIR)) {
    const indexPath = join(PLUGINS_DIR, dir, 'src', 'index.ts')
    if (!existsSync(indexPath)) continue
    const mod: unknown = await import(pathToFileURL(indexPath).href)
    if (!hasManifest(mod)) continue
    const manifest = mod.manifest
    plugins.push({
      dir,
      id: manifest.id,
      label: manifest.label,
      defaultEnabled: manifest.defaultEnabled ?? false
    })
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id))
}
