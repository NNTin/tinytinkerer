// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  facadeModuleId?: string | null
  imports?: string[]
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
    expect((entry?.code?.length ?? 0) / 1024).toBeLessThan(99)
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
