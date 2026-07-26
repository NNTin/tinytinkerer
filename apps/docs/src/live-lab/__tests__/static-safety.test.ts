// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8')

// Strips comments so the "no token" check below inspects only executable code —
// prose explaining WHY a file must stay token-free is exactly what these files
// should say, and shouldn't itself trip the check.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

// The framework's product-runtime dependency must be reachable through exactly one
// door: client-runtime.tsx, itself only ever loaded via React.lazy behind
// Docusaurus's <BrowserOnly> (LiveLab.tsx). Every other MDX-registered component
// (LiveLab.tsx's own module scope, LiveSessionGate, LabReset, MDXComponents) must
// stay free of a STATIC import of the product package — a static import would ship
// (and, worse, execute at SSR time) on every docs page, even ones with no lab,
// which is exactly what issue #451's "pages without labs download no product
// runtime bundle" and "static builds never touch window/IndexedDB/network"
// acceptance criteria forbid.
const LIGHT_FILES = [
  'LiveLab.tsx',
  'LiveSessionGate.tsx',
  'LabReset.tsx',
  'lab-session-context.ts',
  'index.ts',
  'plugin-tool-picker/PluginToolPickerLab.tsx',
  'pixel-agents/PixelAgentsLab.tsx',
  'execution-trace/ExecutionTraceLab.tsx',
  '../theme/MDXComponents.tsx'
]

describe('live-lab bundle boundary', () => {
  it.each(LIGHT_FILES)('%s never statically imports the product runtime', (path) => {
    const source = readSource(path)
    expect(source).not.toMatch(/from ['"]@tinytinkerer\/app-browser['"]/)
    expect(source).not.toMatch(/from ['"]\.\/client-runtime['"]/)
  })

  it('LiveLab.tsx only reaches client-runtime through React.lazy', () => {
    const source = readSource('LiveLab.tsx')
    expect(source).toMatch(/lazy\(\(\) => import\(['"]\.\/client-runtime['"]\)\)/)
  })

  it('client-runtime.tsx is the sole static importer of the product runtime', () => {
    const source = readSource('client-runtime.tsx')
    expect(source).toMatch(/from ['"]@tinytinkerer\/app-browser['"]/)
  })

  it('PluginToolPickerLab.tsx only reaches its content through React.lazy', () => {
    const source = readSource('plugin-tool-picker/PluginToolPickerLab.tsx')
    expect(source).toMatch(/lazy\(\(\) =>\s*\n?\s*import\(['"]\.\/PluginToolPickerLabContent['"]\)/)
  })

  // Each ready-made lab (issue #457's "each lab must lazy-load heavyweight
  // dependencies") repeats the same pattern as PluginToolPickerLab above: its own
  // wrapper component stays light, deferring to its *Content component (the one
  // that actually imports @tinytinkerer/pixel-agents and the chat runtime) only
  // via React.lazy.
  it('PixelAgentsLab.tsx only reaches its content through React.lazy', () => {
    const source = readSource('pixel-agents/PixelAgentsLab.tsx')
    expect(source).toMatch(/lazy\(\(\) =>\s*\n?\s*import\(['"]\.\/PixelAgentsLabContent['"]\)/)
  })

  it('ExecutionTraceLab.tsx only reaches its content through React.lazy', () => {
    const source = readSource('execution-trace/ExecutionTraceLab.tsx')
    expect(source).toMatch(/lazy\(\(\) =>\s*\n?\s*import\(['"]\.\/ExecutionTraceLabContent['"]\)/)
  })

  // lab-session-context.ts is deliberately excluded here: deriveLabSessionSnapshot
  // takes a `token: string | null` as an EXISTENCE check (has one or not) to decide
  // signed-out vs. ready, but the TYPES that reach these render-facing files
  // (LabSessionSnapshot, LabSessionContextValue) carry no token field at all — so
  // it is a type error for any of them to even reference one, let alone render it.
  const RENDER_FACING_FILES = [
    'LiveLab.tsx',
    'LiveSessionGate.tsx',
    'LabReset.tsx',
    'plugin-tool-picker/PluginToolPickerLab.tsx',
    'pixel-agents/PixelAgentsLab.tsx',
    'execution-trace/ExecutionTraceLab.tsx',
    '../theme/MDXComponents.tsx'
  ]

  it.each(RENDER_FACING_FILES)('%s never references a token in code', (path) => {
    const code = stripComments(readSource(path))
    // The always-loaded gate/reset surface must be structurally incapable of
    // rendering a credential (issue #451: "authentication tokens are absent from
    // generated HTML... and displayed request inspectors") — enforced here by
    // never even naming one in executable code.
    expect(code.toLowerCase()).not.toMatch(/token/)
  })
})
