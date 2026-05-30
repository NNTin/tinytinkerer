// @vitest-environment node
/**
 * BUNDLE SIZE REGRESSION GUARD
 * ============================
 * !! DO NOT DELETE OR WEAKEN THESE TESTS !!
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The browser app used to pull too much runtime and rendering code into the
 * initial web payload. Heavy chat/runtime imports, persistence setup, and rich
 * content renderers were able to leak into eagerly-loaded modules and bloat the
 * startup path.
 *
 * The current production strategy is:
 * - keep app bootstrap small and synchronous
 * - lazy-load the chat route
 * - lazy-load settings UI
 * - lazy-load chat/runtime internals on first use
 * - lazy-load specialized content renderers such as code, Mermaid, and
 *   wireframe support
 * - ship production output without source maps
 *
 * These tests enforce that strategy against an actual production-shaped Vite
 * build. The test harness forces `NODE_ENV=production` because running under
 * Vitest's default `NODE_ENV=test` inflates chunk sizes and gives misleading
 * regression signals.
 *
 * WHAT THE BUDGETS MEAN
 * ---------------------
 * - Entry chunk:
 *   protects first-load parse and boot cost
 * - Lazy chat route chunk:
 *   ensures route-level splitting stays effective
 * - Non-vendor chunk ceiling:
 *   catches accidental hot-path imports in any app-owned chunk
 * - React vendor ceiling:
 *   keeps framework growth visible without conflating it with app code
 * - No source maps:
 *   prevents production debug artifacts from being emitted
 *
 * IF A TEST FAILS
 * ---------------
 * 1. Run `pnpm --filter @tinytinkerer/web build`.
 * 2. Inspect the generated chunk sizes and identify which budget failed.
 * 3. Trace the offending import chain. Common causes:
 *    - importing `@tinytinkerer/app-core`, `@tinytinkerer/agent-core`, or
 *      app-browser internals from eagerly-loaded modules
 *    - moving settings, persistence, auth, or runtime code back into startup
 *    - importing specialized content renderers outside lazy paths
 *    - adding a new heavy dependency to `main.tsx`, router code, or other
 *      modules that load before the chat surface mounts
 * 4. Move the offending code behind `import()` or `React.lazy()`, or keep it
 *    inside a route/component that is already lazy-loaded.
 * 5. Only raise thresholds as a last resort, and document why the new budget is
 *    justified by a concrete product requirement.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputChunk = {
  type: 'chunk'
  fileName: string
  code?: string
  isEntry?: boolean
  name?: string
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
    chunks = allEntries.filter((entry): entry is OutputChunk => entry.type === 'chunk' && typeof entry.code === 'string')
    assets = allEntries.filter((entry): entry is OutputAsset => entry.type === 'asset')
  } finally {
    process.env.NODE_ENV = previousNodeEnv
  }
}, 30_000)

describe('web bundle regression guard', () => {
  it('keeps the startup entry chunk under 65 kB', () => {
    const entry = chunks.find((chunk) => chunk.isEntry)
    expect(entry, 'No entry chunk found in build output').toBeDefined()
    expect((entry!.code?.length ?? 0) / 1024).toBeLessThan(65)
  })

  it('keeps the lazy chat route chunk under 40 kB', () => {
    const chunk = chunks.find((entry) => entry.fileName.includes('chat-page'))
    expect(chunk, 'No chat route chunk found in build output').toBeDefined()
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
})
