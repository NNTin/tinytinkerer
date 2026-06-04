/**
 * License policy for production dependencies.
 *
 * `allow`  — permissive licenses that are fine to ship without review.
 * `warn`   — weak-copyleft licenses we tolerate but want surfaced in CI logs.
 * `block`  — strong-copyleft licenses incompatible with this project; they fail
 *            the compliance gate.
 *
 * Anything that matches none of these (e.g. UNKNOWN, custom, or unrecognized
 * SPDX ids) is treated as a warning so a human reviews it, rather than silently
 * passing or hard-failing the pipeline.
 */
export const LICENSE_POLICY = {
  allow: ['MIT', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC'],
  warn: ['LGPL', 'MPL-2.0'],
  block: ['GPL', 'GPL-2.0', 'GPL-3.0', 'AGPL', 'AGPL-3.0']
}

/**
 * Dependencies whose license pnpm cannot resolve to a recognized SPDX id, but
 * which a human has already reviewed and accepted. Keyed by package name; the
 * value records why it is safe.
 *
 * The compliance gate fails on any unrecognized license that is NOT listed here,
 * so a new unreviewed dependency can never pass silently — while the known,
 * already-vetted exceptions don't break CI on every run.
 */
export const REVIEWED_LICENSE_EXCEPTIONS = {
  // khroma is published under MIT (see its repository) but ships no `license`
  // field in package.json, so pnpm reports it as UNKNOWN. Manually verified MIT.
  khroma: 'MIT (declared in source, missing from package metadata)'
}

const VERDICT = /** @type {const} */ ({
  ALLOW: 'allow',
  WARN: 'warn',
  BLOCK: 'block',
  REVIEW: 'review'
})

export { VERDICT }

/**
 * Classify a single SPDX license token (no operators) against the policy.
 *
 * Matching is family-aware so versioned ids resolve correctly:
 *   - "AGPL-3.0-only" -> block, "GPL-3.0-or-later" -> block
 *   - "LGPL-3.0" -> warn (and is NOT swallowed by the GPL block family)
 *   - "Apache-2.0" / "BSD-3-Clause" -> allow
 */
const classifyToken = (token) => {
  const id = token.trim().toUpperCase()
  if (!id) return VERDICT.REVIEW

  // Order matters: AGPL and LGPL must be tested before the bare GPL family so
  // they are not misclassified by the substring "GPL".
  if (/^AGPL/.test(id)) return VERDICT.BLOCK
  if (/^LGPL/.test(id)) return VERDICT.WARN
  if (/^GPL/.test(id)) return VERDICT.BLOCK
  if (id.startsWith('MPL')) return VERDICT.WARN

  if (id === 'MIT' || id === 'ISC' || id === '0BSD' || id === 'UNLICENSE')
    return VERDICT.ALLOW
  if (id.startsWith('BSD')) return VERDICT.ALLOW
  if (id.startsWith('APACHE')) return VERDICT.ALLOW
  if (id.startsWith('CC0')) return VERDICT.ALLOW
  if (id.startsWith('PYTHON')) return VERDICT.ALLOW

  return VERDICT.REVIEW
}

/** Pick the most permissive verdict (used ACROSS the OR operands of an expression). */
const mostPermissive = (verdicts) => {
  if (verdicts.includes(VERDICT.ALLOW)) return VERDICT.ALLOW
  if (verdicts.includes(VERDICT.WARN)) return VERDICT.WARN
  if (verdicts.includes(VERDICT.REVIEW)) return VERDICT.REVIEW
  return VERDICT.BLOCK
}

/** Pick the most restrictive verdict (used WITHIN the AND operands of an expression). */
const mostRestrictive = (verdicts) => {
  if (verdicts.includes(VERDICT.BLOCK)) return VERDICT.BLOCK
  if (verdicts.includes(VERDICT.REVIEW)) return VERDICT.REVIEW
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
 * @returns {'allow' | 'warn' | 'block' | 'review'}
 */
export const evaluateLicense = (expression) => {
  const tokens = tokenizeExpression(String(expression ?? ''))
  if (tokens.length === 0) return VERDICT.REVIEW

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
    if (token === undefined) return VERDICT.REVIEW

    if (token === '(') {
      advance()
      const verdict = parseOr()
      if (peek() === ')') advance()
      return verdict
    }
    if (token === ')' || isOperator(token)) return VERDICT.REVIEW

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
