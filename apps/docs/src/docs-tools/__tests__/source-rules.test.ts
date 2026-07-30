/**
 * Source-level rules #477 states as absolutes, checked mechanically rather than
 * left to review: no documentation tool reads the rendered page, and none of
 * them fetches a URL.
 *
 * Both are properties of the *code*, not of one code path, so a behavioural test
 * can only ever sample them. This is the same shape as
 * `docs-page/__tests__/static-rendering.test.tsx`'s "no DOM extraction" guard,
 * for the same reason.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Resolved from the workspace root rather than `import.meta.url`: under jsdom
 * Vite rewrites the module URL to a `/@fs/...` form `fileURLToPath` rejects.
 * Same reason as docs-page/__tests__/site-corpus-fixture.ts.
 */
const sourceDirectory = resolve(process.cwd(), 'src/docs-tools')

const sourceFiles = readdirSync(sourceDirectory).filter(
  (name) => name.endsWith('.ts') || name.endsWith('.tsx')
)

/** Prose explaining why a rule exists must not trip the rule. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('documentation tool source rules', () => {
  it('covers every module in the directory', () => {
    expect(sourceFiles.length).toBeGreaterThan(5)
  })

  it.each(sourceFiles)('%s never reads the rendered page', (name) => {
    const source = stripComments(readFileSync(join(sourceDirectory, name), 'utf8'))

    expect(source).not.toMatch(/\bwindow\b/)
    expect(source).not.toMatch(/\bdocument\.(title|body|head|getElement|querySelector)/)
    expect(source).not.toMatch(
      /querySelectorAll?|getElementById|getElementsBy|innerText|textContent|innerHTML|outerHTML/
    )
  })

  it.each(sourceFiles)('%s performs no fetch of its own', (name) => {
    const source = stripComments(readFileSync(join(sourceDirectory, name), 'utf8'))

    // Every byte a documentation tool returns comes from the #474 corpus stores,
    // which fetch only locations the build-time manifest recorded. A `fetch` here
    // would be the seam through which a model-supplied string could become a
    // request.
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest|EventSource|WebSocket|import\(\s*[a-z]/i)
  })

  it.each(sourceFiles)('%s does not reach into live-lab or chat state', (name) => {
    const source = stripComments(readFileSync(join(sourceDirectory, name), 'utf8'))

    // #477 is explicit that documentation tools consume no live-lab output,
    // conversation, or tool state.
    expect(source).not.toMatch(/live-lab|useChatStore|useAuthStore|chat-store/)
  })
})
