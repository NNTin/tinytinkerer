// @vitest-environment node
/**
 * BUNDLE SIZE GUARD — root composition app
 * ========================================
 * The root `/` renders all three shells (web + mobile as Sidebar, widget as
 * Floating) over one shared session. It is a first-party showcase surface, not a
 * hot production route, so the budgets here are intentionally lenient: this guard
 * exists to keep the shared build policy applied (React vendor split, no production
 * source maps) rather than to police a tight startup budget.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputChunk = { type: 'chunk'; fileName: string; code?: string }
type OutputAsset = { type: 'asset'; fileName: string }

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
      build: { write: false, minify: 'esbuild', sourcemap: false }
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
}, 30_000)

describe('root app bundle guard', () => {
  it('splits the shared React vendor chunk (shared build policy applied)', () => {
    const vendor = chunks.find((chunk) => chunk.fileName.includes('react-vendor'))
    expect(vendor, 'No React vendor chunk found in build output').toBeDefined()
    expect((vendor!.code?.length ?? 0) / 1024).toBeLessThan(300)
  })

  it('does not emit production source maps', () => {
    expect(assets.some((asset) => asset.fileName.endsWith('.map'))).toBe(false)
  })
})
