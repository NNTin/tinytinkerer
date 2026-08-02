/**
 * The disclosure's version is coupled to its content (issue #481 re-review,
 * item 5).
 *
 * A reader's acknowledgement records a version. If the words can change while
 * the version does not, an acknowledgement of one statement silently carries
 * forward as an acknowledgement of a different one — which is the exact failure
 * the previous review round found in the copy itself, and a comment asking a
 * future editor to remember is not a defence against it.
 *
 * So the version IS a hash of what a reader sees. This test recomputes it; an
 * edit to the title or the paragraphs fails here until the constant is updated,
 * which is what makes the coupling an invariant rather than a request.
 *
 * The same trade the product already makes for `PRIVACY_POLICY_VERSION`, which
 * is a SHA-256 of `docs/overview/PRIVACY.md`: cosmetic edits re-prompt too, and
 * an occasional unnecessary prompt costs far less than an unenforceable
 * "substantive versus cosmetic" rule.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DOCS_ASSISTANT_DISCLOSURE,
  DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS,
  DOCS_ASSISTANT_DISCLOSURE_TITLE,
  DOCS_ASSISTANT_DISCLOSURE_VERSION
} from '../assistant-disclosure'

/**
 * The derivation, and the only copy of it.
 *
 * It lives here rather than in the module because `assistant-disclosure.ts` is
 * loaded by `@theme/Root` on every documentation page and must stay free of
 * `node:crypto`. A short SHA-256 over canonical JSON of the reader-visible
 * fields — the same shape and truncation `scripts/generate-privacy-policy.mjs`
 * uses for `PRIVACY_POLICY_VERSION`. JSON rather than a join, so a paragraph
 * boundary cannot be forged by moving text across one.
 */
const disclosureVersionFor = (title: string, paragraphs: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify({ title, paragraphs })).digest('hex').slice(0, 12)

describe('the documentation assistant disclosure', () => {
  it('carries a version derived from the words a reader actually sees', () => {
    const recomputed = disclosureVersionFor(
      DOCS_ASSISTANT_DISCLOSURE_TITLE,
      DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS
    )

    expect(
      DOCS_ASSISTANT_DISCLOSURE_VERSION,
      'The disclosure text changed without its version. Readers who acknowledged the old ' +
        `wording must be asked again — set DOCS_ASSISTANT_DISCLOSURE_VERSION to "${recomputed}".`
    ).toBe(recomputed)
  })

  it('hashes the title and every paragraph, in order', () => {
    // Pinning the derivation's PROPERTIES, not just its output: a version that
    // ignored a paragraph, or that was order-insensitive, would let real edits
    // through while this file still looked green.
    const [first, ...rest] = DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS
    expect(disclosureVersionFor(DOCS_ASSISTANT_DISCLOSURE_TITLE, rest)).not.toBe(
      DOCS_ASSISTANT_DISCLOSURE_VERSION
    )
    expect(disclosureVersionFor(DOCS_ASSISTANT_DISCLOSURE_TITLE, [...rest, first])).not.toBe(
      DOCS_ASSISTANT_DISCLOSURE_VERSION
    )
    expect(
      disclosureVersionFor('A different title', DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS)
    ).not.toBe(DOCS_ASSISTANT_DISCLOSURE_VERSION)
  })

  it('ships the version it derives', () => {
    expect(DOCS_ASSISTANT_DISCLOSURE.version).toBe(DOCS_ASSISTANT_DISCLOSURE_VERSION)
    expect(DOCS_ASSISTANT_DISCLOSURE.paragraphs).toBe(DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS)
  })

  it('says what the implementation actually guarantees', () => {
    const text = DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS.join(' ')

    // The narrow claim (#481 review, finding 3): content to a model, not "no
    // network request" — a documentation page fetches the corpus manifest and
    // the shell may ask the edge which models exist.
    expect(text).toContain('does not send any conversation or documentation content to a model')
    expect(text).not.toMatch(/nothing leaves your browser/i)
    // Search returns excerpts; only a read returns a page's text. Calling both
    // "the source Markdown" described half of what the tools do.
    expect(text).not.toMatch(/the source Markdown/i)
    expect(text).toContain('only when it uses one of its documentation tools')
  })
})
