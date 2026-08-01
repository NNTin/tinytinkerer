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
  'assistant-runtime-loader.ts',
  'assistant-activation.ts',
  'assistant-surface.ts',
  'assistant-surfaces.tsx',
  'assistant-constants.ts',
  'subscribable.ts',
  'runtime-config.ts',
  '../theme/Root.tsx'
]

describe('assistant bundle boundary', () => {
  it.each(LIGHT_FILES)('%s never statically imports the product runtime', (path) => {
    const source = stripTypeOnlySpecifiers(readSource(path))
    expect(source).not.toMatch(/from ['"]@tinytinkerer\/app-browser['"]/)
    expect(source).not.toMatch(/from ['"]@tinytinkerer\/app-browser\//)
    // Nor anything that does, transitively.
    expect(source).not.toMatch(/from ['"]\.\/assistant-runtime-client['"]/)
    expect(source).not.toMatch(/from ['"]\.\/assistant-app['"]/)
    expect(source).not.toMatch(/from ['"]\.\/create-docs-app['"]/)
    expect(source).not.toMatch(/from ['"]\.\/session['"]/)
  })

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
    // A provider wrapping `children` would remount every documentation page —
    // and every live lab running on one — the first time a reader opened the
    // assistant. See issue #479 decision 2.
    expect(source).toMatch(/\{children\}\s*\n\s*<DocsAssistantRuntimeHost \/>/)
  })
})
