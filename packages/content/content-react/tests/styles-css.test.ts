import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// jsdom does not apply stylesheets, so the honest check for issue #358 (long
// unbroken tokens overflowing message bubbles) is that the shipped CSS carries
// the wrapping rule on the shared .tt-markdown root, where it inherits into
// paragraphs, list items, table cells, and headings.
describe('styles.css', () => {
  it('lets long unbroken tokens wrap inside .tt-markdown (issue #358)', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')
    expect(css).toMatch(/\.tt-markdown\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
