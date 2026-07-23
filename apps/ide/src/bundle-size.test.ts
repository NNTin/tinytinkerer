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
  moduleIds?: string[]
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let chunks: OutputChunk[] = []

beforeAll(async () => {
  const result = await build({
    root,
    logLevel: 'silent',
    mode: 'production',
    build: { write: false, minify: 'esbuild', sourcemap: false }
  })
  const output = Array.isArray(result) ? result[0] : result
  chunks = (output as { output: OutputChunk[] }).output.filter(
    (entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string'
  )
}, 30_000)

describe('IDE bundle regression guard', () => {
  it('keeps Sandpack outside the browser-shell startup graph', () => {
    const entry = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('/ide/index.html'))
    const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
    const startup = new Set<OutputChunk>()
    const visit = (chunk: OutputChunk | undefined) => {
      if (!chunk || startup.has(chunk)) return
      startup.add(chunk)
      for (const imported of chunk.imports ?? []) visit(byName.get(imported))
    }
    visit(entry)

    const sandpackModules = [...startup].flatMap((chunk) =>
      (chunk.moduleIds ?? []).filter((id) => id.includes('@codesandbox/sandpack'))
    )
    expect(entry).toBeDefined()
    expect(sandpackModules).toEqual([])
  })

  it('keeps the lazy IDE stage and CodeMirror vendor bounded', () => {
    // Raised 280 → 282 kB (2026-07-23): the conversation switcher trigger and
    // canStartRun wiring (issue #430) grow docked-chat-surface.tsx and
    // floating-chat-surface.tsx, which this app folds into the single ide-page
    // chunk rather than splitting into its own chat-surface chunk like the shell
    // app does. Same real growth the shell app's chat-surface budget already
    // absorbed; this app just had no dedicated chunk to isolate it in.
    const stage = chunks.find((chunk) => chunk.fileName.includes('ide-page'))
    const codeMirror = chunks.find((chunk) => chunk.fileName.includes('codemirror-vendor'))
    expect(stage).toBeDefined()
    expect(codeMirror).toBeDefined()
    expect((stage?.code?.length ?? 0) / 1024).toBeLessThan(282)
    expect((codeMirror?.code?.length ?? 0) / 1024).toBeLessThan(800)
  })
})
