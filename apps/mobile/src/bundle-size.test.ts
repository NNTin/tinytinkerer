// @vitest-environment node
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
  const outDir = await mkdtemp(`${tmpdir()}/tinytinkerer-mobile-bundle-`)

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
    chunks = allEntries.filter((entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string')
    assets = allEntries.filter((entry): entry is OutputAsset => entry.type === 'asset')
    serviceWorkerSource = await readFile(resolve(outDir, 'sw.js'), 'utf8')
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    await rm(outDir, { recursive: true, force: true })
  }
}, 30_000)

describe('mobile bundle regression guard', () => {
  it('keeps the startup entry chunk under 65 kB', () => {
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    expect((entry!.code?.length ?? 0) / 1024).toBeLessThan(65)
  })

  it('keeps the lazy mobile route chunk under 40 kB', () => {
    const chunk = chunks.find((entry) => entry.fileName.includes('mobile-page'))
    expect(chunk, 'No mobile route chunk found in build output').toBeDefined()
    expect((chunk!.code?.length ?? 0) / 1024).toBeLessThan(40)
  })

  it('keeps every non-vendor JS chunk under 120 kB', () => {
    for (const chunk of chunks) {
      if (chunk.fileName.includes('-vendor')) {
        continue
      }
      expect(
        (chunk.code?.length ?? 0) / 1024,
        `Chunk "${chunk.fileName}" exceeded the 120 kB budget.`
      ).toBeLessThan(120)
    }
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
