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
  ['0BSD', 'allow'],
  ['MPL-2.0', 'warn'],
  ['Unlicense', 'warn'],
  ['LGPL-2.1-only', 'warn'],
  ['GPL-3.0', 'block'],
  ['AGPL-3.0-or-later', 'block'],

  // Unrecognized / undefined / missing licenses must fail (verdict 'unknown')
  ['SomeWeirdLicense', 'unknown'],
  ['UNKNOWN', 'unknown'],
  ['', 'unknown'],

  // Family-aware matching (AGPL/LGPL must not be swallowed by the GPL family)
  ['LGPL-3.0-only', 'warn'],
  ['AGPL-3.0-only', 'block'],
  ['Apache-2.0+', 'allow'],

  // Simple OR (most permissive) / AND (most restrictive)
  ['MIT OR GPL-3.0', 'allow'],
  ['MIT AND GPL-3.0', 'block'],
  ['(MPL-2.0 OR Apache-2.0)', 'allow'],

  // An unknown term can be escaped by OR, but taints an AND
  ['MIT OR SomeWeirdLicense', 'allow'],
  ['MIT AND SomeWeirdLicense', 'unknown'],

  // WITH exceptions only relax the base license
  ['Apache-2.0 WITH LLVM-exception', 'allow'],
  ['GPL-2.0-only WITH Classpath-exception-2.0', 'block'],

  // Nested AND/OR — a mandatory GPL term blocks regardless of a permissive group
  ['GPL-3.0-only AND (MIT OR BSD-3-Clause)', 'block'],
  ['(MIT OR BSD-3-Clause) AND GPL-3.0-only', 'block'],
  ['(MIT AND GPL-3.0) OR Apache-2.0', 'allow'],
  ['(GPL-3.0-only AND MIT) AND (MIT OR ISC)', 'block'],

  // Nested groups settle to the strictest tolerated verdict
  ['(MIT OR Apache-2.0) AND (LGPL-3.0 OR MPL-2.0)', 'warn'],

  // Malformed expressions must never pass silently as their first token — they
  // are 'unknown' (and therefore fail the gate).
  ['MIT GPL-3.0-only', 'unknown'], // two licenses, no operator (leftover token)
  ['MIT License', 'unknown'], // stray trailing word
  ['MIT OR', 'unknown'], // dangling OR
  ['MIT AND', 'unknown'], // dangling AND
  ['(MIT', 'unknown'], // unmatched '('
  ['MIT)', 'unknown'], // stray ')'
  ['MIT WITH', 'unknown'], // WITH without an exception
  ['AND MIT', 'unknown'], // leading operator
  ['()', 'unknown'] // empty group
]

for (const [expression, expected] of cases) {
  test(`evaluateLicense(${JSON.stringify(expression)}) === ${expected}`, () => {
    assert.equal(evaluateLicense(expression), expected)
  })
}
