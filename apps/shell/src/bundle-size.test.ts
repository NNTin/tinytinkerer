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
import { withProductionNodeEnv } from '../../../config/bundle-test-utils'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  isEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  moduleIds?: string[]
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
  const outDir = await mkdtemp(`${tmpdir()}/tinytinkerer-shell-bundle-`)

  try {
    const result = await withProductionNodeEnv(() =>
      build({
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
    )
    const output = Array.isArray(result) ? result[0] : result
    const allEntries = (output as { output: Array<OutputChunk | OutputAsset> }).output
    chunks = allEntries.filter(
      (entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string'
    )
    assets = allEntries.filter((entry): entry is OutputAsset => entry.type === 'asset')
    serviceWorkerSource = await readFile(resolve(outDir, 'sw.js'), 'utf8')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 30_000)

describe('shell bundle regression guard', () => {
  it('keeps the startup entry chunk under 69 kB', () => {
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
    // duplicates (then plugins/is-plugin-module.ts — since removed, see below —
    // plus stores/settings-defaults.ts and stores/run-registry.ts) so the entry no
    // longer has a static edge into the merged ~123 kB app-core/agent-core/
    // contracts chunk (see the next test).
    // Trading ~750 bytes of duplicated code in the entry for no longer fetching
    // that whole chunk eagerly is the point of the fix, not a regression.
    // Raised 68 → 69 kB (2026-08-02, issue #481): the pre-send disclosure gate.
    // Measured at 67.77 kB before, 68.40 kB after — ~630 bytes, split between the
    // optional `preSendDisclosure` data on `BrowserApp` plus the one preference
    // read `initializeBrowserApp` does for it (~280 bytes), and the lazy host
    // `BrowserAppShell` mounts (~350 bytes).
    //
    // The gate's store, hooks and dialog are NOT in this figure and must not
    // become so: they were, at first, and cost 1.2 kB — the store now lives in
    // `pre-send-disclosure.ts`, built lazily by the first surface that needs it,
    // and `app.ts` reaches past it to `pre-send-disclosure-key.ts` for the two
    // things it genuinely needs eagerly. If this budget moves again for this
    // feature, that split is what to check first.
    //
    // What remains is eager because it has to be: the acknowledgement is read
    // during bootstrap so the lazily-built gate starts out already knowing the
    // answer, rather than having to treat "not loaded yet" as "ask again" and
    // re-prompting a reader who accepted months ago.
    //
    // NOT raised for issue #489 (2026-08-03), which made the human-prompt queue
    // one store per `BrowserApp` instead of one per module. Measured at 68.818 kB
    // before and 68.960 kB after — ~142 bytes, for the per-app construction in
    // `createBrowserApp` and the two actions the chat store forwards to the
    // runtime factory.
    //
    // The renderers, the presentation hook and the modal's ownership election are
    // NOT in that figure and must not become so. The election was briefly called
    // from `BrowserAppShell`, which put its registry in this entry and cost 736
    // bytes — over budget on its own. It now runs inside the lazily-loaded
    // `HumanPromptHost`, so the entry carries only the one-property capability
    // check that decides whether to mount the lazy boundary at all.
    //
    // Also NOT raised for issue #498 (2026-08-03), the launcher attention badge
    // and announcement. Measured 68.960 → 68.977 kB — ~17 bytes, all of it the
    // run-end prompt cleanup in `chat-store`'s `finally` and the conversation key
    // `ConversationRunRegistry.release` now reports so that cleanup can be scoped.
    // The badge, the live region, the attention prop and the shared surface hook
    // are in the lazy chat route chunk, not here; the loading boundary is
    // unchanged.
    //
    // LOWERED in practice, not raised, by issue #495 (2026-08-04): 70,632 →
    // 69,108 bytes, so headroom against 69 kB went from ~24 bytes to 1,548. The
    // budget number is deliberately left at 69 kB — the headroom is real and
    // available, and lowering the ceiling to bank it would only force a raise
    // back through review for the next honest 100 bytes.
    //
    // Where it came from: plugin discovery moved out of `app-browser` into
    // `@tinytinkerer/catalogue`, taking with it the `import.meta.glob` and the
    // entry-local `plugins/is-plugin-module.ts`. That module WAS on the #441
    // "load-bearing, do not clean up" list two paragraphs above; the condition
    // recorded there for removing it was `@tinytinkerer/app-core` leaving its
    // merged manualChunks bucket, and that is NOT what happened. It left for a
    // different reason the note did not anticipate: its sole production importer
    // was the registry, and the registry is no longer in this entry at all. The
    // other two duplicates — `stores/run-registry.ts` and
    // `stores/settings-defaults.ts` — are imported by chat-store and
    // settings-store, are still in this entry, and remain load-bearing under the
    // original condition.
    //
    // So the earlier conclusion ("treat this budget as spent… the next change has
    // to profile the entry rather than reach for a known extraction") no longer
    // holds, and the 1,548 bytes are there to be spent. Raising the number is
    // still a product decision about startup cost, not a formality.
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    expect((entry!.code?.length ?? 0) / 1024).toBeLessThan(69)
  })

  it('keeps the app-core chunk out of the entry chunk static import graph', () => {
    // Regression guard for issue #441: three long-standing eager value imports
    // (isPluginModule in the since-removed plugins/registry.ts; SETTINGS_KEYS and
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

  it('keeps the plugin catalogue out of the entry chunk', () => {
    // Issue #495's lazy-reach invariant, asserted structurally.
    //
    // A `BrowserApp` gets its plugins as a thunk, and every composition reaches
    // `@tinytinkerer/catalogue` through a dynamic `import()` INSIDE that thunk.
    // Hoisting it to a static import at the top of `main.tsx` still typechecks,
    // still passes every test, and still works at runtime — it just moves the
    // catalogue's per-plugin import map into this entry chunk, which is exactly
    // where the `import.meta.glob` it replaced used to sit.
    //
    // The byte budget above CANNOT catch that, which is why this test exists
    // rather than a sentence in a doc comment. Measured 2026-08-04: hoisting the
    // import costs 1,070 bytes and lands the entry at 68.533 kB — comfortably
    // UNDER the 69 kB ceiling. It would have shipped green today, before any
    // future raise. Same reasoning as the app-core static-edge test below: the
    // import graph shows what a size check cannot.
    //
    // Two halves, because the violation has two signatures and either alone is
    // weaker: the catalogue module lands in this chunk's own modules, AND each
    // plugin's chunk becomes a DIRECT dynamic import of the entry (10 of them, at
    // last measurement) instead of hanging off the catalogue's own lazy chunk.
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()

    expect(
      (entry!.moduleIds ?? []).filter((id) => id.includes('/packages/app/catalogue/')),
      'The plugin catalogue is in the startup entry. Reach it through a dynamic ' +
        "import() inside the `plugins` thunk — see PluginCatalogue's doc comment."
    ).toEqual([])

    const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
    const pluginChunksOffEntry = (entry!.dynamicImports ?? []).filter((fileName) =>
      (byFileName.get(fileName)?.moduleIds ?? []).some((id) => id.includes('/packages/plugins/'))
    )
    expect(
      pluginChunksOffEntry,
      'Plugin chunks are dynamic imports of the startup entry, which means the ' +
        'catalogue map was inlined into it.'
    ).toEqual([])
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
    //
    // NOT raised for issue #498 (2026-08-03), which put the launcher attention
    // badge, its dedicated polite live region, the generic `attention` prop and
    // the shared `useHumanPromptSurface` hook in here — the right place for them,
    // since all four are the interactive surface rather than something opened from
    // it. Measured 59.915 kB, which leaves under 100 bytes. This budget is now as
    // tight as the entry one: the next addition to the chat surface needs a real
    // reduction beside it, not a raise.
    //
    // NOT raised for issue #496 (2026-08-05), and this is the case the note above
    // was written for. Tokenising `docked-chat-surface.tsx` and
    // `turn-activity-panel.tsx` — 69 literal colour classes onto the token graph,
    // so an embedded surface follows its host's theme — costs real bytes, because
    // `bg-[var(--panel)]` is nine characters longer than `bg-white` and there are
    // dozens of them. It first measured 60.257 kB, i.e. red.
    //
    // The reduction beside it was duplication those literals had been hiding:
    // four copies of the composer's icon-button chrome, two byte-identical
    // neutral entries in `statusStyles`, and three pairs in `VARIANTS` whose two
    // size variants differed only in radius/padding/font-size while repeating the
    // whole palette. Hoisted, the table now carries only the size deltas —
    // which is what `sizeVariant` means — and the file reads better for it.
    //
    // Net 59.915 -> **59.777 kB**: the change pays for itself and returns ~140
    // bytes. Ceiling deliberately left at 60 so the headroom stays available
    // rather than needing a raise back through review.
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
