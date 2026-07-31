/**
 * The deterministic `Sources` footer (issue #478).
 *
 * It exists so citation availability does not depend on model compliance — not
 * so every successful result gets listed. A search that returned five pages of
 * which the model used one must not footnote the answer with the four it
 * rejected, so the footer carries only what the answer *owes*:
 *
 * - every cross-page `read_doc` the answer did not already cite;
 * - or, for an answer built purely from search snippets that cites nothing, the
 *   single highest-ranked result.
 *
 * A current-page read owes nothing, so a page summary finishes with no footer at
 * all.
 */
import { targetToHref } from './canonical-target'
import type { DocumentationCitation, DocumentationCitationLedger } from './citation-ledger'

const SOURCES_HEADING = '**Sources**'

/**
 * Which citations this answer still owes, in discovery order.
 *
 * Deduplicated by canonical **document**: a base-page citation settles the
 * obligation even where a more specific anchor existed, because a second link to
 * the same page buys specificity at the cost of looking like a second source.
 */
export const missingCitations = (
  ledger: DocumentationCitationLedger,
  cited: ReadonlySet<string>
): readonly DocumentationCitation[] => {
  const missing = ledger.obligations.filter((citation) => !cited.has(citation.target.document))
  if (ledger.obligations.length > 0) {
    return missing
  }

  // No document was read, so the answer rests on search snippets. One citation
  // is what that earns — and none at all if the model already cited a result it
  // was shown.
  if (ledger.searchFallback === null) {
    return []
  }
  const citedAnySearchResult = ledger.eligible.some(
    (citation) => citation.origin === 'search' && cited.has(citation.target.document)
  )
  return citedAnySearchResult ? [] : [ledger.searchFallback]
}

// Markdown link syntax is the one place a documentation title (authored prose,
// and free to contain brackets) can break out of the citation it labels.
const escapeLinkText = (value: string): string => value.replace(/([[\]\\])/g, '\\$1')

// A permalink is a slug in practice, but "in practice" is not a guarantee: an
// angle-bracket destination is the syntax that survives parentheses and spaces.
const formatDestination = (href: string): string => (/[\s()<>]/.test(href) ? `<${href}>` : href)

const formatCitation = (citation: DocumentationCitation): string => {
  const label = citation.section ? `${citation.title} — ${citation.section}` : citation.title
  return `- [${escapeLinkText(label)}](${formatDestination(targetToHref(citation.target))})`
}

/**
 * A list rather than a bare link per line: `content-markdown` renders a
 * paragraph containing only a link as a preview card, which would turn a
 * two-source footer into two full-width cards below every answer.
 */
const renderFooter = (citations: readonly DocumentationCitation[]): string =>
  [SOURCES_HEADING, '', ...citations.map(formatCitation)].join('\n')

/**
 * Whether a candidate answer really *renders* every owed citation as a link.
 *
 * Concatenating Markdown does not make a link: an answer whose last fence was
 * never closed absorbs everything after it, so the footer becomes lines inside a
 * `codeBlock` and the document contains no link node at all. An unterminated
 * HTML block or comment does the same. That is exactly the case the deterministic
 * fallback exists for, so "a citation is available" has to be checked against the
 * parsed document rather than assumed from the string.
 */
export type FooterVerifier = (candidate: string, expected: readonly string[]) => boolean

/**
 * Attaches the footer so that every owed citation is a link in the rendered
 * document, or returns the answer untouched when nothing is owed.
 *
 * Appending is tried first because it is what a reader expects. When the model's
 * own Markdown swallows it, the footer is moved **ahead** of the answer instead:
 * a leading block cannot be captured by a construct that opens after it. That is
 * a deliberate trade — an unusual position beats a missing citation, and it
 * never discards a word the model wrote.
 */
export const attachSourcesFooter = (
  source: string,
  citations: readonly DocumentationCitation[],
  verify: FooterVerifier
): string => {
  if (citations.length === 0) {
    return source
  }
  const footer = renderFooter(citations)
  const body = source.replace(/\s+$/, '')
  if (body.length === 0) {
    return footer
  }

  const expected = citations.map((citation) => targetToHref(citation.target))
  const appended = `${body}\n\n${footer}\n`
  if (verify(appended, expected)) {
    return appended
  }
  // Last resort rather than first choice, and unconditional: if even this does
  // not verify, nothing about the answer can make a link render, and returning
  // it is still strictly better than returning the swallowed version.
  return `${footer}\n\n${body}`
}
