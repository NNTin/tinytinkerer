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

  if (id === 'MIT' || id === 'ISC' || id === '0BSD' || id === 'UNLICENSE') return VERDICT.ALLOW
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
 * Evaluate a full license expression (which may be an SPDX expression such as
 * "(MPL-2.0 OR Apache-2.0)") against the policy.
 *
 * OR operands are the most permissive (the consumer may pick any one), while AND
 * operands are the most restrictive (the consumer must satisfy all of them) — so
 * a blocked license can't hide behind "MIT AND GPL-3.0".
 *
 * @param {string} expression
 * @returns {'allow' | 'warn' | 'block' | 'review'}
 */
export const evaluateLicense = (expression) => {
  const orGroups = expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((group) => group.trim())
    .filter(Boolean)

  if (orGroups.length === 0) return VERDICT.REVIEW

  const groupVerdicts = orGroups.map((group) => {
    const tokens = group
      .split(/\s+AND\s+/i)
      // An SPDX "<license> WITH <exception>" only relaxes the base license, so we
      // classify by the license and discard the exception identifier.
      .map((token) => token.replace(/\s+WITH\s+.*$/i, '').trim())
      .filter(Boolean)
    if (tokens.length === 0) return VERDICT.REVIEW
    return mostRestrictive(tokens.map(classifyToken))
  })

  return mostPermissive(groupVerdicts)
}
