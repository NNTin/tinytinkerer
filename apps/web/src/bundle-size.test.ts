// @vitest-environment node
/**
 * BUNDLE SIZE REGRESSION GUARD
 * =============================
 * !! DO NOT DELETE OR WEAKEN THESE TESTS !!
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before issue #24 the entire web app shipped as a single 733 kB JS chunk.
 * That was caused by @tinytinkerer/agent-core, react-markdown, and remark-gfm
 * all being imported from eagerly-loaded modules, ending up in the main entry
 * bundle and blocking the initial page parse.
 *
 * The fix (PR #30) lazy-loads the chat route (React.lazy) so those heavy deps
 * land in a separate chunk that is only fetched when the page first renders.
 * The main entry chunk dropped to ~123 kB.
 *
 * These tests make sure that regression can never silently return.
 *
 * IF A TEST FAILS
 * ---------------
 * 1. Run `pnpm --filter @tinytinkerer/web build` and look at the chunk sizes.
 * 2. Identify the offending import:
 *    a. Add `rollup-plugin-visualizer` to vite.config.ts temporarily, rebuild,
 *       and open the generated `stats.html` treemap.
 *    b. Or run: pnpm dlx vite-bundle-visualizer in apps/web.
 * 3. The most common culprits are:
 *    - Importing @tinytinkerer/agent-core from any eagerly-loaded file
 *      (auth-store, main.tsx, top-bar, router, etc.)
 *    - Importing react-markdown or remark-gfm outside the lazy chat chunk
 *    - Adding a new heavy library to a module that is NOT behind React.lazy()
 * 4. Move the offending import behind a dynamic import() or React.lazy().
 *    See apps/web/src/app/router.tsx for the existing lazy-loading pattern.
 * 5. Only raise the numeric thresholds below as a last resort, and always add
 *    a comment explaining why the new limit is justified.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type OutputEntry = {
  type: string
  fileName: string
  code?: string
  isEntry?: boolean
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let chunks: OutputEntry[] = []

beforeAll(async () => {
  const result = await build({
    root,
    logLevel: 'silent',
    build: { write: false },
  })
  const output = Array.isArray(result) ? result[0] : result
  const allEntries = (output as { output: OutputEntry[] }).output
  chunks = allEntries.filter((e) => e.type === 'chunk' && typeof e.code === 'string')
}, 30_000)

describe('[DO NOT DELETE] Bundle size regression guard — see file header for motivation and recovery steps', () => {
  it('keeps every JS chunk under 500 kB to prevent parse-blocking payloads', () => {
    for (const chunk of chunks) {
      const sizeKB = (chunk.code?.length ?? 0) / 1024
      expect(
        sizeKB,
        `Chunk "${chunk.fileName}" is ${sizeKB.toFixed(1)} kB which exceeds the 500 kB limit. ` +
          'See the top of apps/web/src/bundle-size.test.ts for investigation and recovery steps.',
      ).toBeLessThan(500)
    }
  })

  it('keeps the main entry chunk under 200 kB to avoid blocking initial page load', () => {
    const entry = chunks.find((c) => c.isEntry)
    expect(entry, 'No entry chunk found in build output — check vite.config.ts').toBeDefined()

    const sizeKB = (entry!.code?.length ?? 0) / 1024
    expect(
      sizeKB,
      `Main entry chunk is ${sizeKB.toFixed(1)} kB which exceeds the 200 kB limit. ` +
        'The entry chunk has grown too large, likely because a heavy import was added to an ' +
        'eagerly-loaded module. See the top of apps/web/src/bundle-size.test.ts for recovery steps.',
    ).toBeLessThan(200)
  })
})
