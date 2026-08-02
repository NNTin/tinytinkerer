// The scoping transform behind the generated embed preflight (issue #480
// re-review, finding 3).
//
// The generator's whole value is that the rules it applies are mechanical rather
// than remembered, so THOSE rules are what this pins — against small fixtures,
// not against whatever Tailwind currently ships. The freshness check
// (`pnpm check:embed-preflight`) covers the other half: that the committed output
// matches the installed Tailwind.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { transform } from './generate-embed-preflight.mjs'

test('scopes an element selector without adding specificity', () => {
  assert.equal(
    transform('button {\n  border: 0 solid;\n}'),
    ':where(.tt-app-embed) button {\n  border: 0 solid;\n}'
  )
})

test('splits a selector list on top-level commas only', () => {
  const output = transform(':where(select:is([multiple], [size])) optgroup, li {\n  margin: 0;\n}')
  // The `:is(…)` list must survive intact; the outer list must be scoped twice.
  assert.match(
    output,
    /:where\(\.tt-app-embed\) :where\(select:is\(\[multiple\], \[size\]\)\) optgroup/
  )
  assert.match(output, /:where\(\.tt-app-embed\) li/)
})

test('expands a bare universal selector over an element list', () => {
  const output = transform('* {\n  margin: 0;\n}')
  // `:where(.x) *` is (0,0,0) and loses to every element rule a host theme
  // declares, so the enumeration at (0,0,1) is what actually applies the reset.
  assert.match(output, /^:where\(\.tt-app-embed\),\n:where\(\.tt-app-embed\) \*,/)
  assert.match(output, /:where\(\.tt-app-embed\) ul,/)
  assert.match(output, /:where\(\.tt-app-embed\) button,/)
})

test('drops rules that address the document root, which belongs to the host', () => {
  assert.equal(transform('html,\n:host {\n  line-height: 1.5;\n}'), '')
})

test('drops the comment introducing a rule it drops', () => {
  assert.equal(transform('/* about the root */\nhtml {\n  tab-size: 4;\n}'), '')
})

test('keeps the comment introducing a rule it keeps', () => {
  assert.equal(
    transform('/* about lists */\nul {\n  list-style: none;\n}'),
    '/* about lists */\n\n:where(.tt-app-embed) ul {\n  list-style: none;\n}'
  )
})

test('rewrites --theme() to var(), preserving the whole fallback list', () => {
  const output = transform(
    "code {\n  font-family: --theme(--x, Menlo, 'Courier New', monospace);\n}"
  )
  assert.match(output, /font-family: var\(--x, Menlo, 'Courier New', monospace\);/)
})

test('descends into a supported at-rule and scopes its inner selectors', () => {
  const output = transform('@supports (color: red) {\n  ::placeholder {\n    opacity: 1;\n  }\n}')
  assert.match(
    output,
    /^@supports \(color: red\) \{\n {2}:where\(\.tt-app-embed\) ::placeholder \{/
  )
})

test('throws on an at-rule it does not know how to scope', () => {
  // The whole point of a hand-written walker: emitting an unrecognised construct
  // unscoped would put product rules on the host's own pages, which is exactly
  // the failure the scoping model exists to prevent.
  assert.throws(
    () => transform('@layer base {\n  p {\n    margin: 0;\n  }\n}'),
    /Unsupported at-rule/
  )
})

test('throws rather than silently dropping trailing content', () => {
  assert.throws(
    () => transform('p { margin: 0; }\n@charset "utf-8";'),
    /Unhandled trailing content/
  )
})
