// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withProductionNodeEnv } from '../../../config/bundle-test-utils'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  facadeModuleId?: string | null
  imports?: string[]
  dynamicImports?: string[]
  isEntry?: boolean
  moduleIds?: string[]
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let shellChunks: OutputChunk[] = []
let callbackChunks: OutputChunk[] = []

const outputChunks = (result: Awaited<ReturnType<typeof build>>): OutputChunk[] => {
  const output = Array.isArray(result) ? result[0] : result
  return (output as { output: OutputChunk[] }).output.filter(
    (entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string'
  )
}

beforeAll(async () => {
  const [shellResult, callbackResult] = await withProductionNodeEnv(async () => {
    const shellResult = await build({
      root,
      logLevel: 'silent',
      mode: 'production',
      build: { write: false, minify: 'esbuild', sourcemap: false }
    })
    const callbackResult = await build({
      configFile: resolve(root, 'vite.callback.config.ts'),
      logLevel: 'silent',
      mode: 'production',
      build: { write: false, minify: 'esbuild', sourcemap: false }
    })
    return [shellResult, callbackResult]
  })
  shellChunks = outputChunks(shellResult)
  callbackChunks = outputChunks(callbackResult)
}, 90_000)

describe('canvas bundle regression guard', () => {
  it('keeps the twenty-five-tool startup entry below 99 kB', () => {
    const entry = shellChunks.find((chunk) => chunk.facadeModuleId?.endsWith('/canvas/index.html'))
    expect(entry).toBeDefined()
    // Raised 84 → 85 kB when the shared chat surface gained always-loaded turn
    // reconciliation + memoization (#340): a deliberate perf feature that stops
    // the whole conversation re-rendering per streamed delta.
    // Raised 85 → 90 kB when the boot/loading panel moved into the shared
    // @tinytinkerer/app-browser LoadingStatusPanel (#370): the startup entry now
    // carries all four presentation variants' chrome (~4.6 kB raw, ~1.5 kB
    // gzipped) so the panel — including the boot-failure Reload affordance —
    // has one implementation instead of five drifting copies.
    // Raised 90 → 92 kB when the safer-workflow verbs landed (#318, 2026-07):
    // the startup entry now carries three more tool descriptions plus the
    // preview/thumbnail/pick input schemas (~1.4 kB raw) so the model can call
    // them; the verbs' behavior stays in the lazy canvas-stage graph.
    // Raised 92 → 93 kB (2026-07-09): the preview/thumbnail tool descriptions
    // grew a sentence explaining the `media` handle + `![caption](<mediaRef>)`
    // embed convention now that their rendered image travels as display-only
    // media instead of an inline base64 field.
    // Raised 93 → 94 kB (2026-07-10): pick/read gained an optional `fields`
    // projection (id/type/kind plus only the requested keys, for large
    // selections) — the enum, the two schemas' extra property, and the two tool
    // descriptions' extra sentence add a little over 400 bytes raw.
    // Raised 94 → 97 kB (2026-07-11), absorbing two features at once: the konami
    // cheat code's always-loaded lazy wrapper + wiring (the recognizer/animation
    // stay in their lazy chunk), which had already pushed develop to ~94.4 kB,
    // and the per-tool enablement discovery-time reconciliation (issue #400):
    // the settings store's reconcilePluginTools action and its bootstrap wiring
    // in initializeBrowserApp are startup code by design — the sweep must run
    // where discovery meets hydrated settings, before the first runtime build.
    // The tool picker itself (slot + panel) contributes nothing here: it lives
    // in the lazily-loaded chat-surface graph.
    // Raised 97 → 99 kB for the integrated canvas stage: the lightweight
    // in-process controller handle and package-local lazy-stage loader now live in
    // startup, while Excalidraw and the domain controller remain guarded below.
    // Raised 99 → 100 kB for completed-call outcome routing (#419): startup
    // carries only the lightweight per-tool async summary boundary; the Canvas
    // outcome matrix itself remains in a separate lazy chunk.
    // Raised 100 → 102 kB (2026-07-24, issue #441): app-browser's registry.ts,
    // settings-store.ts, and chat-store.ts moved isPluginModule, SETTINGS_KEYS,
    // defaultSettingsState, and ConversationRunRegistry/MAX_CONCURRENT_RUNS from
    // static VALUE imports of `@tinytinkerer/app-core` to small entry-local
    // duplicates, so every app-browser shell's entry no longer has a static edge
    // into the merged ~123 kB app-core/agent-core/contracts chunk. Trading ~750
    // bytes of duplicated code in the entry for no longer fetching that whole
    // chunk eagerly is the point of the fix, not a regression.
    //
    // LOWERED in practice, not raised, by issue #495 (2026-08-04): 99,683 →
    // 98,286 bytes, so headroom against 102 kB went from 4,765 to 6,162. Plugin
    // discovery moved out of `app-browser` into `@tinytinkerer/catalogue`, taking
    // the `import.meta.glob` and the entry-local `plugins/is-plugin-module.ts`
    // with it — the latter had been on #441's "load-bearing, do not clean up"
    // list, and left for a reason that list did not anticipate: its only
    // production importer was the registry, which is no longer in this entry.
    // `stores/run-registry.ts` and `stores/settings-defaults.ts` are unaffected
    // and remain load-bearing. The ceiling is left at 102 kB so the freed bytes
    // stay available rather than needing a raise back through review.
    expect((entry?.code?.length ?? 0) / 1024).toBeLessThan(102)
  })

  it('keeps the plugin catalogue out of the canvas startup entry', () => {
    // Issue #495's lazy-reach invariant. The same guard as
    // `apps/shell/src/bundle-size.test.ts` — see its longer note — repeated here
    // because this is a second, independently-composed entry: `apps/canvas`
    // passes its own `plugins` thunk through `createBrowserShellRoot`, so it can
    // regress on its own. Measured on the shell, hoisting the catalogue to a
    // static import cost 1,070 bytes and still passed the byte budget, which is
    // why this is an import-graph assertion rather than a size one.
    const byFileName = new Map(shellChunks.map((chunk) => [chunk.fileName, chunk]))
    const entry = shellChunks.find((chunk) => chunk.facadeModuleId?.endsWith('/canvas/index.html'))
    expect(entry).toBeDefined()

    expect(
      (entry!.moduleIds ?? []).filter((id) => id.includes('/packages/app/catalogue/')),
      'The plugin catalogue is in the canvas startup entry. Reach it through a ' +
        'dynamic import() inside the `plugins` thunk in apps/canvas/src/main.tsx.'
    ).toEqual([])

    const pluginChunksOffEntry = (entry!.dynamicImports ?? []).filter((fileName) =>
      (byFileName.get(fileName)?.moduleIds ?? []).some((id) => id.includes('/packages/plugins/'))
    )
    expect(
      pluginChunksOffEntry,
      'Plugin chunks are dynamic imports of the canvas entry, which means the ' +
        'catalogue map was inlined into it.'
    ).toEqual([])
  })

  it('keeps Excalidraw outside the canvas startup graph', () => {
    const byFileName = new Map(shellChunks.map((chunk) => [chunk.fileName, chunk]))
    const entry = shellChunks.find((chunk) => chunk.facadeModuleId?.endsWith('/canvas/index.html'))
    expect(entry).toBeDefined()

    const startupChunks = new Set<OutputChunk>()
    const visit = (chunk: OutputChunk | undefined) => {
      if (!chunk || startupChunks.has(chunk)) return
      startupChunks.add(chunk)
      for (const imported of chunk.imports ?? []) visit(byFileName.get(imported))
    }
    visit(entry)

    const excalidrawModules = [...startupChunks].flatMap((chunk) =>
      (chunk.moduleIds ?? []).filter((id) => id.includes('node_modules/@excalidraw/'))
    )
    expect(excalidrawModules).toEqual([])
  })

  it('emits a dedicated, bounded lazy Excalidraw graph', () => {
    const stage = shellChunks.find((chunk) =>
      (chunk.moduleIds ?? []).some((id) => id.endsWith('/packages/app/canvas/src/canvas-stage.tsx'))
    )
    const excalidrawChunks = shellChunks.filter((chunk) =>
      (chunk.moduleIds ?? []).some(
        (id) => id.includes('node_modules/@excalidraw/') || id.includes('node_modules/roughjs/')
      )
    )

    expect(stage).toBeDefined()
    expect(excalidrawChunks.length).toBeGreaterThan(0)
    expect(
      excalidrawChunks.reduce((bytes, chunk) => bytes + (chunk.code?.length ?? 0), 0) / 1024
    ).toBeLessThan(5120)
  })

  it('keeps the library-callback relay free of Excalidraw and React', () => {
    const entry = callbackChunks.find((chunk) =>
      chunk.facadeModuleId?.endsWith('/library-callback/index.html')
    )
    expect(entry).toBeDefined()
    const heavyModules = callbackChunks.flatMap((chunk) =>
      (chunk.moduleIds ?? []).filter(
        (id) => id.includes('node_modules/@excalidraw/') || id.includes('node_modules/react')
      )
    )
    expect(heavyModules).toEqual([])
  })
})
