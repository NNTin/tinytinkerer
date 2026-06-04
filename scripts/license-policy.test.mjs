import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateLicense } from './license-policy.mjs'

// Each case is [expression, expected verdict]. The nested cases are the ones a
// flat OR/AND split gets wrong: a mandatory blocked term must not be able to
// hide behind a permissive parenthesised group beside it.
const cases = [
  // Plain identifiers
  ['MIT', 'allow'],
  ['ISC', 'allow'],
  ['Apache-2.0', 'allow'],
  ['BSD-3-Clause', 'allow'],
  ['MPL-2.0', 'warn'],
  ['LGPL-2.1-only', 'warn'],
  ['GPL-3.0', 'block'],
  ['AGPL-3.0-or-later', 'block'],
  ['SomeWeirdLicense', 'review'],
  ['', 'review'],

  // Family-aware matching (AGPL/LGPL must not be swallowed by the GPL family)
  ['LGPL-3.0-only', 'warn'],
  ['AGPL-3.0-only', 'block'],
  ['Apache-2.0+', 'allow'],

  // Simple OR (most permissive) / AND (most restrictive)
  ['MIT OR GPL-3.0', 'allow'],
  ['MIT AND GPL-3.0', 'block'],
  ['(MPL-2.0 OR Apache-2.0)', 'allow'],

  // WITH exceptions only relax the base license
  ['Apache-2.0 WITH LLVM-exception', 'allow'],
  ['GPL-2.0-only WITH Classpath-exception-2.0', 'block'],

  // Nested AND/OR — a mandatory GPL term blocks regardless of a permissive group
  ['GPL-3.0-only AND (MIT OR BSD-3-Clause)', 'block'],
  ['(MIT OR BSD-3-Clause) AND GPL-3.0-only', 'block'],
  ['(MIT AND GPL-3.0) OR Apache-2.0', 'allow'],
  ['(GPL-3.0-only AND MIT) AND (MIT OR ISC)', 'block'],

  // Nested groups settle to the strictest tolerated verdict
  ['(MIT OR Apache-2.0) AND (LGPL-3.0 OR MPL-2.0)', 'warn']
]

for (const [expression, expected] of cases) {
  test(`evaluateLicense(${JSON.stringify(expression)}) === ${expected}`, () => {
    assert.equal(evaluateLicense(expression), expected)
  })
}
