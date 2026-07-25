// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')

// The playground's real content-platform dependency must be reachable through
// exactly one door: client-runtime.tsx, itself only ever loaded via React.lazy
// behind Docusaurus's <BrowserOnly> (RichContentPlayground.tsx). Every other
// MDX-registered/always-loaded file must stay free of a STATIC import of
// @tinytinkerer/app-browser — a static import would ship (and execute at SSR
// time) on every docs page, even ones with no playground, which is exactly
// what issue #455's "ordinary documentation pages do not include the
// playground's heavy runtime chunks" acceptance criterion forbids.
const LIGHT_FILES = [
  'RichContentPlayground.tsx',
  'constants.ts',
  'url-param.ts',
  'index.ts',
  '../theme/MDXComponents.tsx'
]

describe('rich-content playground bundle boundary', () => {
  it.each(LIGHT_FILES)('%s never statically imports the content-platform runtime', (path) => {
    const source = readSource(path)
    expect(source).not.toMatch(/from ['"]@tinytinkerer\/app-browser['"]/)
    expect(source).not.toMatch(/from ['"]\.\/client-runtime['"]/)
  })

  it('RichContentPlayground.tsx only reaches client-runtime through React.lazy', () => {
    const source = readSource('RichContentPlayground.tsx')
    expect(source).toMatch(/lazy\(\(\) => import\(['"]\.\/client-runtime['"]\)\)/)
  })

  it('client-runtime.tsx is the sole static importer of the content-platform runtime', () => {
    const source = readSource('client-runtime.tsx')
    expect(source).toMatch(/from ['"]@tinytinkerer\/app-browser['"]/)
    expect(source).toMatch(/import ['"]@tinytinkerer\/app-browser\/styles\.css['"]/)
  })
})
