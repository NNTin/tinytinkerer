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
let iframeChunks: OutputChunk[] = []
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
  const iframeResult = await build({
    configFile: resolve(root, 'vite.excalidraw.config.ts'),
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
  iframeChunks = outputChunks(iframeResult)
  callbackChunks = outputChunks(callbackResult)
}, 90_000)

describe('canvas bundle regression guard', () => {
  it('keeps the twenty-five-tool startup entry below 92 kB', () => {
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
    // them; the verbs' behavior stays in the iframe graph.
    // Excalidraw and the heavy graph are still guarded out by the tests below.
    expect((entry?.code?.length ?? 0) / 1024).toBeLessThan(92)
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

  it('emits a dedicated, bounded Excalidraw iframe graph', () => {
    const entry = iframeChunks.find((chunk) =>
      chunk.facadeModuleId?.endsWith('/excalidraw-app/index.html')
    )
    const vendor = iframeChunks.find((chunk) => chunk.fileName.includes('excalidraw-vendor'))

    expect(entry).toBeDefined()
    expect(vendor).toBeDefined()
    expect((vendor?.code?.length ?? 0) / 1024).toBeLessThan(5120)
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
