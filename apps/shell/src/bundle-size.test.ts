// @vitest-environment node
/**
 * BUNDLE SIZE REGRESSION GUARD
 * ============================
 * !! DO NOT DELETE OR WEAKEN THESE TESTS !!
 *
 * The single browser shell is ONE build served at /web/, /widget/, and /mobile/.
 * That makes its startup path the shared cost of every endpoint, so the same budgets
 * the former per-shell guards enforced apply here against a production-shaped build:
 * keep the entry small and synchronous, lazy-load the chat route, lazy-load settings
 * and runtime internals, lazy-load specialized content renderers, and ship no source
 * maps. It also asserts the mobile PWA service worker precache stays free of the
 * Mermaid runtime (the mobile presentation is the only one that registers the SW).
 *
 * IF A TEST FAILS
 * ---------------
 * 1. Run `pnpm exec turbo run build --filter=@tinytinkerer/shell`.
 * 2. Identify which budget failed and trace the offending import chain. Common causes:
 *    importing app-core/agent-core/app-browser internals from eagerly-loaded modules;
 *    moving settings/persistence/auth/runtime into startup; importing specialized
 *    content renderers outside lazy paths; a heavy dep reaching main.tsx / router /
 *    presentations (which load before the chat surface mounts).
 * 3. Move the offending code behind `import()` / `React.lazy()`.
 * 4. Only raise a threshold as a last resort, with a documented product reason.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  isEntry?: boolean
  imports?: string[]
}

type OutputAsset = {
  type: 'asset'
  fileName: string
  source?: string | Uint8Array
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let chunks: OutputChunk[] = []
let assets: OutputAsset[] = []
let serviceWorkerSource = ''

beforeAll(async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const outDir = await mkdtemp(`${tmpdir()}/tinytinkerer-shell-bundle-`)

  try {
    process.env.NODE_ENV = 'production'

    const result = await build({
      root,
      logLevel: 'silent',
      mode: 'production',
      build: {
        outDir,
        write: true,
        minify: 'esbuild',
        sourcemap: false
      }
    })
    const output = Array.isArray(result) ? result[0] : result
    const allEntries = (output as { output: Array<OutputChunk | OutputAsset> }).output
    chunks = allEntries.filter(
      (entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string'
    )
    assets = allEntries.filter((entry): entry is OutputAsset => entry.type === 'asset')
    serviceWorkerSource = await readFile(resolve(outDir, 'sw.js'), 'utf8')
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    await rm(outDir, { recursive: true, force: true })
  }
}, 30_000)

describe('shell bundle regression guard', () => {
  it('keeps the startup entry chunk under 68 kB', () => {
    // Raised 65 → 66 kB (2026-07-16): per-conversation scoping of the human-prompt
    // bridge and the inspector capture sink (issue #430, PR 3) adds a small,
    // unavoidable amount of real logic to three entry-chunk files (chat-store,
    // human-prompt-bridge, inspector-store) — a `conversationId`/`scope` field, a
    // scoped settle/clear, and the wiring between them. PR 2 already left this
    // budget with only ~70 bytes of headroom, so this modest addition (~200 bytes
    // minified) needed a small raise rather than a deeper refactor.
    // Raised 66 → 68 kB (2026-07-24, issue #441): isPluginModule, SETTINGS_KEYS,
    // defaultSettingsState, and ConversationRunRegistry/MAX_CONCURRENT_RUNS moved
    // from static VALUE imports of `@tinytinkerer/app-core` to small entry-local
    // duplicates (see plugins/is-plugin-module.ts, stores/settings-defaults.ts,
    // stores/run-registry.ts) so the entry no longer has a static edge into the
    // merged ~123 kB app-core/agent-core/contracts chunk (see the next test).
    // Trading ~750 bytes of duplicated code in the entry for no longer fetching
    // that whole chunk eagerly is the point of the fix, not a regression.
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    expect((entry!.code?.length ?? 0) / 1024).toBeLessThan(68)
  })

  it('keeps the app-core chunk out of the entry chunk static import graph', () => {
    // Regression guard for issue #441: three long-standing eager value imports
    // (isPluginModule in plugins/registry.ts; SETTINGS_KEYS and
    // defaultSettingsState in stores/settings-store.ts) used to statically pull
    // `@tinytinkerer/app-core` into the entry — and manualChunks merges app-core
    // with agent-core and contracts into one ~123 kB chunk (see
    // scripts/browser-shell-chunks.mjs), so the browser fetched that whole chunk
    // at startup even though core-module.ts's loadCoreModule() also loads it
    // lazily. The byte-size budget above can't see this: chunk sizes are
    // unchanged either way, only the import graph shows it. This asserts the
    // entry chunk has no static `import ... from "./app-core-*.js"` edge.
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    const staticImports = entry!.imports ?? []
    expect(staticImports.filter((fileName) => fileName.includes('app-core'))).toEqual([])
  })

  it('keeps the lazy chat route chunk under 60 kB', () => {
    // The chat route imports the shared ChatApp (both layout shells + bodies) so the
    // widget↔sidebar morph happens in-place. Still lazy (split from the entry).
    // Raised 55 → 57 kB (2026-07-11): the tool picker's compose-area slot +
    // useToolTree hook (issue #400) are eager in both chat surfaces by design —
    // the button must render whenever the tool-tree plugin is enabled — while
    // the checkbox-tree panel itself stays in its own lazy chunk.
    // Raised 57 → 59 kB (2026-08-01), measured 56.2 → 57.6: the four host
    // capabilities issue #480 added for the documentation assistant — controlled
    // minimization with its focus behaviour, the dynamic starter-prompt
    // override, host-provided sign-in, and the reset behaviour — all live in the
    // window chrome and both chat bodies. None of it can move behind an
    // `import()`: it is the interactive surface itself, not a panel opened from
    // it, and two of the four exist to fix affordances that were reachable but
    // dead (a sign-in button with no flow behind it, a reset that did something
    // other than what it said).
    // Raised 59 → 60 kB (2026-08-02), measured 59.3: the issue #480 re-review
    // replaces three partial presentation controls and two competing storage
    // records with one complete controlled/uncontrolled ChatPresentation. That
    // controller is the widget↔sidebar interaction itself, so it cannot move
    // behind another import. The wrapper was reduced to its type discriminant
    // first (keeping the IDE stage below its unchanged budget); this 1 kB band is
    // the remaining product logic, not duplicated host code.
    const chunk = chunks.find((entry) => entry.fileName.includes('chat-surface'))
    expect(chunk, 'No chat route chunk found in build output').toBeDefined()
    expect((chunk!.code?.length ?? 0) / 1024).toBeLessThan(60)
  })

  it('keeps every non-vendor JS chunk under 120 kB', () => {
    for (const chunk of chunks) {
      // app-core has its own dedicated budget below.
      if (chunk.fileName.includes('-vendor') || chunk.fileName.includes('app-core')) {
        continue
      }
      expect(
        (chunk.code?.length ?? 0) / 1024,
        `Chunk "${chunk.fileName}" exceeded the 120 kB budget.`
      ).toBeLessThan(120)
    }
  })

  it('keeps the lazy app-core chunk under 126 kB', () => {
    // Split out of the generic 120 kB guard (2026-07-16): the multi-conversation
    // state layer (issue #430) deliberately lives in this lazily-loaded chunk —
    // the chat store's action bodies moved into app-core precisely to keep every
    // shell's tightly-budgeted entry chunk flat — pushing it to ~122 kB. A
    // dedicated 126 kB budget absorbs that (plus the remaining #430 slices)
    // without weakening the 120 kB bar for every other chunk.
    const chunk = chunks.find((entry) => entry.fileName.includes('app-core'))
    expect(chunk, 'No app-core chunk found in build output').toBeDefined()
    expect((chunk!.code?.length ?? 0) / 1024).toBeLessThan(126)
  })

  it('keeps the shared React vendor chunk under 300 kB', () => {
    const vendor = chunks.find((chunk) => chunk.fileName.includes('react-vendor'))
    expect(vendor, 'No React vendor chunk found in build output').toBeDefined()
    expect((vendor!.code?.length ?? 0) / 1024).toBeLessThan(300)
  })

  it('keeps the CodeMirror vendor chunk under 800 kB', () => {
    const vendor = chunks.find((chunk) => chunk.fileName.includes('codemirror-vendor'))
    expect(vendor, 'No CodeMirror vendor chunk found in build output').toBeDefined()
    expect((vendor!.code?.length ?? 0) / 1024).toBeLessThan(800)
  })

  it('does not emit production source maps', () => {
    expect(assets.some((asset) => asset.fileName.endsWith('.map'))).toBe(false)
  })

  it('keeps the service worker precache free of the Mermaid runtime', () => {
    expect(serviceWorkerSource).not.toContain('mermaid.min-')
  })
})
