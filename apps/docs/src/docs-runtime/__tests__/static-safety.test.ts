// @vitest-environment node
/**
 * The assistant's bundle boundary (issue #479), enforced at the source level —
 * the same guard `live-lab/__tests__/static-safety.test.ts` puts around the lab
 * framework, for the same reason and with higher stakes.
 *
 * `@theme/Root` is loaded by EVERY documentation page. A static import of the
 * product runtime anywhere on the path from there to the assistant would ship
 * app-browser in every page's initial HTML — and execute it during static
 * rendering. `scripts/check-docs-performance-budget.mjs` catches that in the
 * built output; this catches it in review, with a message that says what to do.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectEagerModuleGraph } from './eager-module-graph'

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')

const readPackageSource = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../packages/app/${relativePath}`, import.meta.url)),
    'utf8'
  )

/**
 * Resolved from the workspace root rather than `import.meta.url`: under jsdom
 * Vite rewrites the module URL to a `/@fs/...` form `fileURLToPath` rejects.
 * Same reason as docs-page/__tests__/site-corpus-fixture.ts.
 */
const APP_ROOT = resolve(process.cwd())

/**
 * `@tinytinkerer/app-browser` subpaths a light module may import FOR REAL.
 *
 * The package barrel pulls the whole product runtime, so importing it from the
 * `@theme/Root` path would ship app-browser in every documentation page. A
 * subpath need not: these are entry points the product publishes precisely so an
 * embedder can share the product's rules without the product's weight (issue
 * #480 re-review, finding 2). Each one is CERTIFIED by the test below, which
 * reads its source and checks what it actually imports — an entry that starts
 * pulling the runtime fails there rather than silently costing every reader a
 * megabyte.
 *
 * Each entry declares what that facade is allowed to depend on, rather than all
 * of them sharing one rule: they are light for different reasons. A presentation
 * store needs React and nothing else; a set of corpus contracts needs the
 * contracts package and no React at all. One shared allowance would have to be
 * the union, which permits each facade the other's dependency for no reason.
 *
 * This certifies the SHAPE. What a light entry point weighs is
 * `scripts/check-docs-performance-budget.mjs`'s `coldPage` profile, which
 * measures the built page rather than reasoning about it.
 */
const LIGHT_APP_BROWSER_SUBPATHS: Record<string, { source: string; mayImport: string[] }> = {
  'chat-presentation': {
    source: 'app-browser/src/chat-presentation.ts',
    // A store's `useSyncExternalStore`, and nothing else.
    mayImport: ['react']
  },
  // Reached from `@theme/Root` by `DocsPageProvider`, which loads the corpus
  // manifest on every route so a navigation into a document resolves
  // immediately (profile 1 of the performance budget, #474/#476's design).
  'documentation-corpus': {
    source: 'app-browser/src/documentation-corpus.ts',
    // Schema version, shared contracts, and the response cap — all types and
    // constants, no runtime.
    mayImport: ['@tinytinkerer/contracts']
  }
}

/**
 * The modules a reader loads without asking for anything.
 *
 * DECLARED — everything else in the graph below is derived from them, which is
 * the point (issue #482). The previous revision listed the whole light set by
 * hand, and by the time it was audited the list had drifted in both directions:
 * two reachable modules were missing from it, and one unreachable module had
 * been on it. A list that can be wrong either way proves nothing either way.
 */
const EAGER_ROOTS = [
  // Docusaurus loads this on every documentation page.
  resolve(APP_ROOT, 'src/theme/Root.tsx'),
  // Eagerly imported by <LiveLab>, and therefore by every MDX page carrying a
  // lab: it reaches the light index to declare its fullscreen overlay (#480).
  resolve(APP_ROOT, 'src/components/lab-container.tsx')
]

/** Modules that must never be reachable without a dynamic import. */
const RUNTIME_ONLY = [
  'src/docs-runtime/assistant-runtime-client.tsx',
  'src/docs-runtime/assistant-app.ts',
  'src/docs-runtime/create-docs-app.ts',
  'src/docs-runtime/session.ts',
  // #480's widget is the one docs-runtime component that renders ChatApp.
  'src/docs-runtime/assistant-widget.tsx',
  // Reads the docked panel geometry off app-browser's barrel.
  'src/docs-runtime/page-inset.ts',
  'src/live-lab/client-runtime.tsx',
  'src/playground/client-runtime.tsx'
]

const eagerGraph = collectEagerModuleGraph(EAGER_ROOTS, APP_ROOT)

describe('assistant bundle boundary', () => {
  it('reaches the modules it is supposed to, so the rule below is asserted over something', () => {
    const labels = eagerGraph.modules.map((module) => module.label)
    // A sanity floor, not a second hand-maintained list: if the walk silently
    // stopped early, every assertion after this one would pass vacuously.
    expect(labels).toContain('src/theme/Root.tsx')
    expect(labels).toContain('src/docs-runtime/index.ts')
    expect(labels).toContain('src/docs-runtime/AssistantRuntimeHost.tsx')
    // The two the hand-maintained list had missed.
    expect(labels).toContain('src/docs-runtime/AssistantPageRegion.tsx')
    expect(labels).toContain('src/docs-runtime/LatchedErrorBoundary.tsx')
    expect(labels.length).toBeGreaterThan(12)
  })

  it('never reaches @tinytinkerer/app-browser except through a certified subpath', () => {
    const offenders = [...eagerGraph.packages]
      .filter(([specifier]) => specifier.startsWith('@tinytinkerer/app-browser'))
      .filter(([specifier]) => {
        const subpath = specifier.slice('@tinytinkerer/app-browser'.length).replace(/^\//, '')
        // The barrel ('') is always out; a subpath only if it is certified below.
        return !Object.keys(LIGHT_APP_BROWSER_SUBPATHS).includes(subpath)
      })
      .map(([specifier, importers]) => `${specifier} (from ${importers.join(', ')})`)

    expect(offenders).toEqual([])
  })

  it.each(RUNTIME_ONLY)('%s is reachable only through a dynamic import', (target) => {
    const reached = eagerGraph.modules.find((module) => module.label === target)
    // The failure message has to name the edge, because "this module is now
    // eager" is useless without "…because X imports it".
    expect(reached ? `${target} <- ${reached.importedBy}` : null).toBeNull()
  })

  it.each(Object.entries(LIGHT_APP_BROWSER_SUBPATHS))(
    'the %s subpath is light enough for a light module to import',
    (_subpath, { source, mayImport }) => {
      // The certification behind the allowance above: an entry that starts
      // pulling a store, a component, or the product barrel fails HERE, rather
      // than as a bundle-size regression nobody can attribute.
      const text = readPackageSource(source)
      const specifiers = [
        // `import x from 'y'` and `export { x } from 'y'` alike: a re-export is
        // as much of a runtime edge as an import, and these facades are mostly
        // re-exports.
        ...text.matchAll(/^\s*(import|export)\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)
      ]
      for (const [statement, , specifier] of specifiers) {
        if (/^\s*(?:import|export)\s+type\s/.test(statement ?? '')) continue
        expect(mayImport).toContain(specifier)
      }
    }
  )

  it('the host reaches the runtime only through React.lazy, per attempt', () => {
    const source = readSource('AssistantRuntimeHost.tsx')
    expect(source).toMatch(/lazy\(importAssistantRuntimeClient\)/)
    // Built inside a memo keyed on the attempt, never once at module scope:
    // React.lazy memoises its rejection, so a shared payload would make every
    // retry rethrow the first failure without re-importing (issue #479 review).
    expect(source).toMatch(/useMemo\(\s*\(\) => lazy\(importAssistantRuntimeClient\)/)
    expect(source).not.toMatch(/^const \w+ = lazy\(/m)
    // …and only in a browser: <BrowserOnly> renders nothing during static
    // rendering, so a build never evaluates the chunk.
    expect(source).toMatch(/BrowserOnly/)
  })

  it('the loader module holds the only import of the runtime chunk', () => {
    const source = readSource('assistant-runtime-loader.ts')
    expect(source).toMatch(/import\(['"]\.\/assistant-runtime-client['"]\)/)
  })

  it('the client module is the sole static importer of the product runtime', () => {
    expect(readSource('assistant-runtime-client.tsx')).toMatch(
      /from ['"]@tinytinkerer\/app-browser['"]/
    )
  })

  it('the light index re-exports only light modules', () => {
    const source = readSource('index.ts')
    // The session facade pulls the runtime, so it stays one module over and is
    // documented as importable from a registered surface only.
    expect(source).not.toMatch(/export \{[^}]*useDocsAssistantSession/s)
    // Its TYPES are free: they erase at build time.
    expect(source).toMatch(/export type \{[^}]*DocsAssistantSession/s)
  })

  it('Root mounts the assistant beside the page, never around it', () => {
    const source = readSource('../theme/Root.tsx')
    // The assistant host is a SIBLING of the page region. A provider wrapping
    // `children` would remount every documentation page — and every live lab
    // running on one — the first time a reader opened the assistant. See issue
    // #479 decision 2.
    //
    // `DocsAssistantPageRegion` is not that: it is a plain element rendered
    // unconditionally in every mode, so it never mounts or unmounts (issue #480
    // re-review, finding 2). What matters is that the host is not inside it.
    expect(source).toMatch(
      /<DocsAssistantPageRegion>\{children\}<\/DocsAssistantPageRegion>\s*\n\s*<DocsAssistantRuntimeHost \/>/
    )
    // Nothing between the region's own tags but `children` — the host cannot be
    // inside it.
    expect(source).not.toMatch(
      /<DocsAssistantPageRegion>(?:(?!<\/DocsAssistantPageRegion>)[\s\S])*<DocsAssistantRuntimeHost/
    )
  })
})
