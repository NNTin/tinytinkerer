/**
 * The citation ledger (issue #478): the only thing in this application allowed
 * to say that a documentation link is real.
 *
 * Everything here is derived by re-parsing a tool result through #477's own
 * output schemas. That is the point rather than belt-and-braces: the ledger is
 * what stands between an answer and a fabricated URL, so it trusts a *typed,
 * validated success* and nothing else — not prose, not a `ref` the model
 * proposed, not a link inside returned Markdown, not a failed call.
 *
 * Two sets come out of it:
 *
 * - **authorized targets** — what may stay clickable. A document any successful
 *   result returned, plus every section anchor those results proved exists.
 * - **obligations** — what the answer owes a citation to. Only successful
 *   cross-page `read_doc` results create one; a search is a discovery
 *   candidate, and a current-page read creates none at all.
 */
import { READ_CURRENT_DOC_TOOL_ID, READ_DOC_TOOL_ID, SEARCH_DOCS_TOOL_ID } from '../docs-tools'
import { readDocOutputSchema, searchDocsOutputSchema } from '../docs-tools/schemas'
import {
  canonicalizeResultPermalink,
  sameDocument,
  targetKey,
  type CanonicalDocumentationTarget,
  type DocumentationSite
} from './canonical-target'

/** A tool result, narrowed to what a policy may see (see `AppToolResultRecord`). */
export type DocumentationToolResult = {
  toolId: string
  output: unknown
}

export type DocumentationCitation = {
  /** Corpus document id, carried for diagnostics and stable identity. */
  ref: string
  title: string
  /** The most specific target this result authorizes — see the anchor rule below. */
  target: CanonicalDocumentationTarget
  /** Section heading, when the result named one. Rendered beside the title. */
  section: string | null
  /** Which tool authorized it. Decides whether it can settle the search fallback. */
  origin: 'search' | 'read' | 'current'
}

export type DocumentationCitationLedger = {
  /**
   * `read_doc` successes, in call order and deduplicated by document. Each owes
   * a citation. Two anchored reads of one page are one obligation: the
   * requirement is settled by the document, not by the section.
   */
  obligations: readonly DocumentationCitation[]
  /**
   * The single citation a search-only answer falls back to: the highest-ranked
   * result of the first successful, non-empty search. `null` when no search
   * succeeded with results.
   */
  searchFallback: DocumentationCitation | null
  /** Every eligible citation, in discovery order — obligations included. */
  eligible: readonly DocumentationCitation[]
  /** Exact targets (document, and document#anchor) that may stay clickable. */
  authorizedTargets: ReadonlySet<string>
}

const EMPTY_LEDGER: DocumentationCitationLedger = {
  obligations: [],
  searchFallback: null,
  eligible: [],
  authorizedTargets: new Set()
}

/**
 * The anchor rule, in one function.
 *
 * A section link is only ever composed from the section the result *returned*.
 * An `anchor` the model passed as input is model text that happened to travel
 * through a tool, and a balanced overview or a full read describes the whole
 * document — picking one of its sections would attribute the answer to a part
 * of the page it did not specifically draw on.
 */
const readAnchor = (
  read: ReturnType<typeof readDocOutputSchema.parse> & { status: 'ok' }
): { anchor: string | null; section: string | null } => {
  if (read.selection !== 'section') {
    return { anchor: null, section: null }
  }
  const section = read.sections[0]
  return {
    anchor: section?.anchor ?? null,
    section: section?.heading ?? null
  }
}

export const buildDocumentationCitationLedger = (
  results: readonly DocumentationToolResult[],
  site: DocumentationSite
): DocumentationCitationLedger => {
  if (results.length === 0) {
    return EMPTY_LEDGER
  }

  const obligations: DocumentationCitation[] = []
  const eligible: DocumentationCitation[] = []
  const authorizedTargets = new Set<string>()
  let searchFallback: DocumentationCitation | null = null

  const authorize = (target: CanonicalDocumentationTarget): void => {
    authorizedTargets.add(targetKey(target))
    // The document itself is always authorized alongside any section of it: a
    // reader citing the page rather than the exact heading is citing something
    // a successful result returned.
    authorizedTargets.add(targetKey({ document: target.document, anchor: null }))
  }

  const remember = (citation: DocumentationCitation): void => {
    authorize(citation.target)
    eligible.push(citation)
  }

  for (const result of results) {
    if (result.toolId === SEARCH_DOCS_TOOL_ID) {
      const parsed = searchDocsOutputSchema.safeParse(result.output)
      if (!parsed.success || parsed.data.status !== 'ok') {
        continue
      }
      parsed.data.results.forEach((hit, index) => {
        const citation: DocumentationCitation = {
          ref: hit.ref,
          title: hit.title,
          target: canonicalizeResultPermalink(hit.permalink, hit.anchor ?? null, site),
          section: hit.section ?? null,
          origin: 'search'
        }
        remember(citation)
        // The fallback is the top hit of the FIRST successful search: a later
        // query is a refinement of the same question, and swapping the fallback
        // for its top hit would make the footer depend on how many times the
        // model chose to re-search.
        if (searchFallback === null && index === 0) {
          searchFallback = citation
        }
      })
      continue
    }

    if (result.toolId === READ_DOC_TOOL_ID || result.toolId === READ_CURRENT_DOC_TOOL_ID) {
      // `read_current_doc` shares the read success shape, so one schema covers
      // both; only the tool id decides whether an obligation is created.
      const parsed = readDocOutputSchema.safeParse(result.output)
      if (!parsed.success || parsed.data.status !== 'ok') {
        continue
      }
      const read = parsed.data
      const { anchor, section } = readAnchor(read)
      const citation: DocumentationCitation = {
        ref: read.doc.ref,
        title: read.doc.title,
        target: canonicalizeResultPermalink(read.doc.permalink, anchor, site),
        section,
        origin: result.toolId === READ_DOC_TOOL_ID ? 'read' : 'current'
      }
      remember(citation)
      // Every anchor the outline returned is a section this document provably
      // has, so a model citing one is citing a result-authorized target — even
      // though only the section actually read is specific enough to generate.
      for (const entry of read.outline) {
        authorize(canonicalizeResultPermalink(read.doc.permalink, entry.anchor, site))
      }
      if (
        result.toolId === READ_DOC_TOOL_ID &&
        !obligations.some((existing) => sameDocument(existing.target, citation.target))
      ) {
        obligations.push(citation)
      }
    }
  }

  return { obligations, searchFallback, eligible, authorizedTargets }
}

/** Whether a link may stay clickable. The single question the render policy asks. */
export const isAuthorizedTarget = (
  ledger: DocumentationCitationLedger,
  target: CanonicalDocumentationTarget
): boolean => ledger.authorizedTargets.has(targetKey(target))
