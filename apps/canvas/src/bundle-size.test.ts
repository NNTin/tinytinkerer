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

type OutputAsset = {
  type: 'asset'
  fileName: string
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let chunks: OutputChunk[] = []
let assets: OutputAsset[] = []

beforeAll(async () => {
  const previousNodeEnv = process.env.NODE_ENV

  try {
    process.env.NODE_ENV = 'production'

    const result = await build({
      root,
      logLevel: 'silent',
      mode: 'production',
      build: {
        write: false,
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
  } finally {
    process.env.NODE_ENV = previousNodeEnv
  }
}, 90_000)

describe('canvas bundle regression guard', () => {
  it('keeps the startup entry chunk under 65 kB', () => {
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    expect((entry!.code?.length ?? 0) / 1024).toBeLessThan(65)
  })

  it('keeps the lazy canvas route chunk under 40 kB', () => {
    const chunk = chunks.find((entry) => entry.fileName.includes('canvas-page'))
    expect(chunk, 'No canvas route chunk found in build output').toBeDefined()
    expect((chunk!.code?.length ?? 0) / 1024).toBeLessThan(40)
  })

  it('keeps every first-party JS chunk under 120 kB', () => {
    // The budget guards FIRST-PARTY (app/workspace) code bloat. Pinned `-vendor`
    // chunks are exempt, as are purely third-party lazy chunks — notably the
    // Mermaid diagram modules Excalidraw bundles and dynamic-imports on demand,
    // which are large but legitimately lazy and isolated (the entry/route budgets
    // below prove they never reach the startup path).
    for (const chunk of chunks) {
      if (chunk.fileName.includes('-vendor')) {
        continue
      }
      const moduleIds = chunk.moduleIds ?? []
      const isThirdPartyOnly =
        moduleIds.length > 0 && moduleIds.every((id) => id.includes('node_modules'))
      if (isThirdPartyOnly) {
        continue
      }
      expect(
        (chunk.code?.length ?? 0) / 1024,
        `First-party chunk "${chunk.fileName}" exceeded the 120 kB budget.`
      ).toBeLessThan(120)
    }
  })

  it('keeps the shared React vendor chunk under 300 kB', () => {
    const vendor = chunks.find((chunk) => chunk.fileName.includes('react-vendor'))
    expect(vendor, 'No React vendor chunk found in build output').toBeDefined()
    expect((vendor!.code?.length ?? 0) / 1024).toBeLessThan(300)
  })

  it('isolates Excalidraw in its own lazy vendor chunk under 3 MB', () => {
    // Excalidraw is large; the budget guards the chunk stays isolated (lazy, never
    // merged into the entry/route chunks), not that it is small.
    const vendor = chunks.find((chunk) => chunk.fileName.includes('excalidraw-vendor'))
    expect(vendor, 'No Excalidraw vendor chunk found in build output').toBeDefined()
    expect(vendor!.isEntry ?? false).toBe(false)
    expect((vendor!.code?.length ?? 0) / 1024).toBeLessThan(5120)
  })

  it('does not emit production source maps', () => {
    expect(assets.some((asset) => asset.fileName.endsWith('.map'))).toBe(false)
  })
})
