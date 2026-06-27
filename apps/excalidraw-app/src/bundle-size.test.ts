// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  isEntry?: boolean
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
}, 90_000)

describe('excalidraw-app bundle regression guard', () => {
  it('keeps Excalidraw isolated from the entry chunk', () => {
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry).toBeDefined()
    expect(entry?.moduleIds?.some((id) => id.includes('node_modules/@excalidraw/'))).toBe(false)
  })

  it('keeps the dedicated Excalidraw vendor chunk below 5 MB', () => {
    const vendor = chunks.find((chunk) => chunk.fileName.includes('excalidraw-vendor'))
    expect(vendor).toBeDefined()
    expect((vendor?.code?.length ?? 0) / 1024).toBeLessThan(5120)
  })
})
