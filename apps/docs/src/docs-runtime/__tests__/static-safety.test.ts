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
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')

const readPackageSource = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../packages/app/${relativePath}`, import.meta.url)),
    'utf8'
  )

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
 */
const LIGHT_APP_BROWSER_SUBPATHS: Record<string, string> = {
  'chat-presentation': 'app-browser/src/chat-presentation.ts'
}

/**
 * Drops `import type` / `export type` statements before the checks below.
 *
 * A type-only specifier is erased by the compiler, so it creates no chunk edge
 * and costs a page nothing — which is exactly why the light index may re-export
 * the session's TYPES while its values stay one module over. Checking the raw
 * text would forbid that and teach the next reader the wrong rule.
 */
const stripTypeOnlySpecifiers = (source: string): string =>
  source.replace(/^\s*(?:import|export)\s+type\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')

// Everything reachable from @theme/Root without activating the assistant.
const LIGHT_FILES = [
  'index.ts',
  'AssistantRuntimeHost.tsx',
  'AssistantLauncher.tsx',
  'assistant-runtime-loader.ts',
  'assistant-activation.ts',
  'assistant-presentation.ts',
  'assistant-starters.ts',
  'assistant-surface.ts',
  'assistant-surfaces.tsx',
  'assistant-constants.ts',
  // #481's disclosure copy. Light on purpose: the light index re-exports it so
  // the built site's own assertions can read the exact paragraphs a reader sees
  // without activating the assistant.
  'assistant-disclosure.ts',
  'host-overlays.ts',
  'subscribable.ts',
  'runtime-config.ts',
  '../theme/Root.tsx',
  // Eagerly imported by <LiveLab>, and therefore by every MDX page carrying a
  // lab: it reaches the light index to declare its fullscreen overlay (#480).
  '../components/lab-container.tsx'
]

describe('assistant bundle boundary', () => {
  it.each(LIGHT_FILES)('%s never statically imports the product runtime', (path) => {
    const source = stripTypeOnlySpecifiers(readSource(path))
    // The barrel is always out; a subpath only if it is on the certified list.
    const imported = [...source.matchAll(/from ['"]@tinytinkerer\/app-browser(?:\/([^'"]+))?['"]/g)]
    for (const [, subpath] of imported) {
      expect(Object.keys(LIGHT_APP_BROWSER_SUBPATHS)).toContain(subpath)
    }
    // Nor anything that pulls the runtime, transitively.
    expect(source).not.toMatch(/from ['"][./]*(?:docs-runtime\/)?assistant-runtime-client['"]/)
    expect(source).not.toMatch(/from ['"][./]*(?:docs-runtime\/)?assistant-app['"]/)
    expect(source).not.toMatch(/from ['"][./]*(?:docs-runtime\/)?create-docs-app['"]/)
    expect(source).not.toMatch(/from ['"][./]*(?:docs-runtime\/)?session['"]/)
    // #480's widget is the one docs-runtime component that renders ChatApp, so
    // it belongs to the runtime chunk and nothing light may name it.
    expect(source).not.toMatch(/from ['"][./]*(?:docs-runtime\/)?assistant-widget['"]/)
  })

  it.each(Object.entries(LIGHT_APP_BROWSER_SUBPATHS))(
    'the %s subpath is light enough for a light module to import',
    (_subpath, source) => {
      // The certification behind the allowance above. React is the one thing a
      // shared contract may need (a store's `useSyncExternalStore`); anything
      // else — a store, a component, another package — would drag the runtime in
      // behind it and undo the whole boundary.
      const imports = [
        ...readPackageSource(source).matchAll(/^\s*import\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)
      ]
      for (const [statement, specifier] of imports) {
        if (/^\s*import\s+type\s/.test(statement ?? '')) continue
        expect(specifier).toBe('react')
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
