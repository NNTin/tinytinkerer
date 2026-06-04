/**
 * License policy for production dependencies.
 *
 * `allow`  — permissive licenses that are fine to ship without review.
 * `warn`   — licenses we tolerate but want surfaced in CI logs.
 * `block`  — copyleft licenses incompatible with this project; they fail the
 *            compliance gate.
 *
 * This list is the source of truth: any license that is not explicitly classified
 * here (or by the SPDX family fallbacks below) is treated as UNKNOWN and FAILS the
 * gate, rather than silently passing. That includes pnpm's "Unknown" sentinel for
 * dependencies that ship no license metadata.
 */
export const LICENSE_POLICY = {
  allow: [
    '0BSD',
    'MIT',
    'ISC',
    'Apache-2.0',
    'BSD',
    'BSD-2-Clause',
    'BSD-3-Clause'
  ],
  warn: ['LGPL', 'MPL-2.0', 'Unlicense'],
  block: ['GPL', 'GPL-2.0', 'GPL-3.0', 'AGPL', 'AGPL-3.0']
}

const VERDICT = /** @type {const} */ ({
  ALLOW: 'allow',
  WARN: 'warn',
  BLOCK: 'block',
  // Unrecognized / undefined / missing license. Treated as a failure: an
  // unclassified license must never pass the gate unnoticed.
  UNKNOWN: 'unknown'
})

export { VERDICT }

// Exact-match lookup built from LICENSE_POLICY so the lists above are the single
// authoritative source for known SPDX ids.
const EXACT_VERDICTS = new Map()
for (const id of LICENSE_POLICY.allow)
  EXACT_VERDICTS.set(id.toUpperCase(), VERDICT.ALLOW)
for (const id of LICENSE_POLICY.warn)
  EXACT_VERDICTS.set(id.toUpperCase(), VERDICT.WARN)
for (const id of LICENSE_POLICY.block)
  EXACT_VERDICTS.set(id.toUpperCase(), VERDICT.BLOCK)

/**
 * Classify a single SPDX license token (no operators) against the policy.
 *
 * Exact ids resolve from LICENSE_POLICY; versioned / variant ids fall back to
 * SPDX family rules so e.g. "AGPL-3.0-only" -> block, "GPL-3.0-or-later" -> block,
 * "LGPL-3.0" -> warn, "BSD-3-Clause" -> allow. Anything left unmatched (including
 * the "UNKNOWN" sentinel) is UNKNOWN and fails the gate.
 */
const classifyToken = (token) => {
  const id = token.trim().toUpperCase()
  if (!id || id === 'UNKNOWN') return VERDICT.UNKNOWN

  const exact = EXACT_VERDICTS.get(id)
  if (exact) return exact

  // Family fallbacks for versioned / variant ids not listed explicitly.
  // Order matters: AGPL and LGPL must be tested before the bare GPL family so
  // they are not misclassified by the substring "GPL".
  if (/^AGPL/.test(id)) return VERDICT.BLOCK
  if (/^LGPL/.test(id)) return VERDICT.WARN
  if (/^GPL/.test(id)) return VERDICT.BLOCK
  if (id.startsWith('MPL')) return VERDICT.WARN
  if (id.startsWith('APACHE')) return VERDICT.ALLOW
  if (id.startsWith('BSD')) return VERDICT.ALLOW

  return VERDICT.UNKNOWN
}

/** Pick the most permissive verdict (used ACROSS the OR operands of an expression). */
const mostPermissive = (verdicts) => {
  if (verdicts.includes(VERDICT.ALLOW)) return VERDICT.ALLOW
  if (verdicts.includes(VERDICT.WARN)) return VERDICT.WARN
  if (verdicts.includes(VERDICT.UNKNOWN)) return VERDICT.UNKNOWN
  return VERDICT.BLOCK
}

/** Pick the most restrictive verdict (used WITHIN the AND operands of an expression). */
const mostRestrictive = (verdicts) => {
  if (verdicts.includes(VERDICT.BLOCK)) return VERDICT.BLOCK
  if (verdicts.includes(VERDICT.UNKNOWN)) return VERDICT.UNKNOWN
  if (verdicts.includes(VERDICT.WARN)) return VERDICT.WARN
  return VERDICT.ALLOW
}

/**
 * Split an SPDX expression into its atomic tokens: parentheses are their own
 * tokens, everything else is separated by whitespace. License ids, `AND`, `OR`,
 * `WITH`, exception ids, and a trailing `+` all come through as plain tokens.
 */
const tokenizeExpression = (expression) => {
  const tokens = []
  const matcher = /\(|\)|[^\s()]+/g
  let match
  while ((match = matcher.exec(expression)) !== null) {
    tokens.push(match[0])
  }
  return tokens
}

/**
 * Evaluate a full SPDX license expression against the policy.
 *
 * Unlike a flat OR/AND split, this is a proper recursive-descent parser that
 * honours parentheses and SPDX precedence (`WITH` binds tightest, then `AND`,
 * then `OR`). That matters for nested expressions: "GPL-3.0-only AND (MIT OR
 * BSD-3-Clause)" correctly resolves to BLOCK, because the GPL term is mandatory
 * and can't be escaped by the permissive OR branch beside it.
 *
 * OR combines to the most permissive verdict (the consumer may pick any branch);
 * AND combines to the most restrictive (every operand must be satisfied). An
 * "<license> WITH <exception>" only relaxes the base license, so the exception
 * identifier is consumed and ignored.
 *
 * @param {string} expression
 * @returns {'allow' | 'warn' | 'block' | 'unknown'}
 */
export const evaluateLicense = (expression) => {
  const tokens = tokenizeExpression(String(expression ?? ''))
  if (tokens.length === 0) return VERDICT.UNKNOWN

  let pos = 0
  const peek = () => tokens[pos]
  const advance = () => tokens[pos++]
  const isOperator = (token) => {
    const upper = token?.toUpperCase()
    return upper === 'AND' || upper === 'OR'
  }

  // primary := '(' or-expr ')' | license-id [ 'WITH' exception-id ]
  const parsePrimary = () => {
    const token = peek()
    if (token === undefined) return VERDICT.UNKNOWN

    if (token === '(') {
      advance()
      const verdict = parseOr()
      if (peek() === ')') advance()
      return verdict
    }
    if (token === ')' || isOperator(token)) return VERDICT.UNKNOWN

    advance() // the license id (possibly with a trailing '+')
    if (peek()?.toUpperCase() === 'WITH') {
      advance() // consume 'WITH'
      const exception = peek()
      if (
        exception !== undefined &&
        exception !== ')' &&
        !isOperator(exception)
      ) {
        advance() // consume the exception id and discard it
      }
    }
    return classifyToken(token.replace(/\+$/, ''))
  }

  // and-expr := primary ( 'AND' primary )*
  const parseAnd = () => {
    let verdict = parsePrimary()
    while (peek()?.toUpperCase() === 'AND') {
      advance()
      verdict = mostRestrictive([verdict, parsePrimary()])
    }
    return verdict
  }

  // or-expr := and-expr ( 'OR' and-expr )*
  const parseOr = () => {
    let verdict = parseAnd()
    while (peek()?.toUpperCase() === 'OR') {
      advance()
      verdict = mostPermissive([verdict, parseAnd()])
    }
    return verdict
  }

  return parseOr()
}
