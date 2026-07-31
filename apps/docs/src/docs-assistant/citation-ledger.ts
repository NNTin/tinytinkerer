/**
 * The citation ledger (issue #478): the only thing in this application allowed
 * to say that a documentation link is real.
 *
 * Everything here is derived by re-parsing a tool result through #477's own
 * output schemas, and only from a result the host attributes to the #477 tool
 * group. That pairing is the point rather than belt-and-braces: schema
 * compatibility proves *shape*, not *origin*, and the ledger is what stands
 * between an answer and a fabricated URL. It trusts a typed, validated success
 * from a known tool and nothing else — not prose, not a `ref` the model
 * proposed, not a link inside returned Markdown, not a failed call, and not a
 * plugin that happens to answer in a compatible shape.
 *
 * Two sets come out of it:
 *
 * - **authorized targets** — what may stay clickable. Each eligible document,
 *   plus exactly the sections a result returned as its own selection.
 * - **obligations** — what the answer owes a citation to. Only successful
 *   cross-page `read_doc` results create one; a search is a discovery
 *   candidate, and a current-page read creates none at all.
 */
import {
  DOCUMENTATION_TOOL_GROUP_ID,
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} from '../docs-tools'
import {
  readCurrentDocOutputSchema,
  readDocOutputSchema,
  searchDocsOutputSchema,
  type ReadDocOutput
} from '../docs-tools/schemas'
import type { AppToolResultRecord } from '@tinytinkerer/app-browser'
import {
  canonicalizeResultPermalink,
  targetKey,
  type CanonicalDocumentationTarget,
  type DocumentationSite
} from './canonical-target'

/**
 * A tool result, narrowed to what a policy may see, plus the provenance the host
 * attached at registration.
 *
 * Aliased rather than restated so this cannot drift from the contract the
 * runtime actually hands over.
 */
export type DocumentationToolResult = AppToolResultRecord

export type DocumentationCitation = {
  /** Corpus document id, carried for diagnostics and stable identity. */
  ref: string
  title: string
  /** The most specific target this evidence authorizes — see the anchor rule below. */
  target: CanonicalDocumentationTarget
  /** Section heading, when the target names one. Rendered beside the title. */
  section: string | null
  /** Which tool authorized it. Decides whether it can settle the search fallback. */
  origin: 'search' | 'read' | 'current'
}

export type DocumentationCitationLedger = {
  /**
   * `read_doc` successes, one per canonical document, in the order each document
   * was first read. Each owes a citation.
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
 * The evidence one document accumulated across a turn.
 *
 * Aggregated rather than first-call-wins, because the two orderings carry the
 * same evidence: a whole read followed by a section read and the reverse both
 * mean "this answer saw the whole page", and a ledger that generated a section
 * link for one and a page link for the other would make the citation depend on
 * the order the model happened to call in.
 */
type DocumentEvidence = {
  ref: string
  title: string
  permalink: string
  /** Sections whose body this turn actually selected, in first-returned order. */
  sections: Map<string, string | null>
  /** A `full` or `balanced_overview` read: the evidence is the whole document. */
  readWhole: boolean
  /** `read_doc`, as opposed to only `read_current_doc`. Creates the obligation. */
  crossPage: boolean
}

/**
 * The anchor rule, in one function.
 *
 * A section link is only ever composed from a section a result *returned as its
 * selection*. An `anchor` the model passed as input is model text that happened
 * to travel through a tool; an outline entry proves a heading exists but not
 * that the answer drew on it; and a whole or balanced read describes the entire
 * document, so naming one of its sections would overstate what it supports.
 *
 * Two distinct sections are a document-level target for the same reason: the
 * evidence spans more of the page than either link alone would claim.
 */
const evidenceTarget = (
  evidence: DocumentEvidence,
  site: DocumentationSite
): { target: CanonicalDocumentationTarget; section: string | null } => {
  const only =
    evidence.readWhole || evidence.sections.size !== 1 ? undefined : [...evidence.sections][0]
  return {
    target: canonicalizeResultPermalink(evidence.permalink, only?.[0] ?? null, site),
    section: only?.[1] ?? null
  }
}

/** A successful read's own selection, as the locked contract defines it. */
const selectedSection = (
  read: Extract<ReadDocOutput, { status: 'ok' }>
): { anchor: string; heading: string | null } | null => {
  if (read.selection !== 'section') {
    return null
  }
  const anchor = read.sections[0]?.anchor
  return anchor ? { anchor, heading: read.sections[0]?.heading ?? null } : null
}

/**
 * Only a result the host attributed to #477's own tool group counts.
 *
 * App tools register after plugins and a colliding plugin id wins (see
 * `create-runtime`), so without this a plugin called `read_doc` answering in a
 * schema-compatible shape could authorize any URL it liked — including on the
 * persisted render path, where the same provenance travels on the tool event.
 */
const isDocumentationTool = (result: DocumentationToolResult): boolean =>
  result.source?.kind === 'app' && result.source.groupId === DOCUMENTATION_TOOL_GROUP_ID

export const buildDocumentationCitationLedger = (
  results: readonly DocumentationToolResult[],
  site: DocumentationSite
): DocumentationCitationLedger => {
  const trusted = results.filter(isDocumentationTool)
  if (trusted.length === 0) {
    return EMPTY_LEDGER
  }

  const eligible: DocumentationCitation[] = []
  const authorizedTargets = new Set<string>()
  const reads = new Map<string, DocumentEvidence>()
  let searchFallback: DocumentationCitation | null = null

  const authorize = (target: CanonicalDocumentationTarget): void => {
    authorizedTargets.add(targetKey(target))
    // The document itself is always authorized alongside any section of it: a
    // reader citing the page rather than the exact heading is citing something
    // a successful result returned.
    authorizedTargets.add(targetKey({ document: target.document, anchor: null }))
  }

  for (const result of trusted) {
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
        authorize(citation.target)
        eligible.push(citation)
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

    const crossPage = result.toolId === READ_DOC_TOOL_ID
    if (!crossPage && result.toolId !== READ_CURRENT_DOC_TOOL_ID) {
      continue
    }

    // Each tool is parsed with its OWN public contract. The two read schemas
    // share a success shape today, and validating both against one of them would
    // silently stop testing the other the moment #477's contracts diverge.
    const parsed = crossPage
      ? readDocOutputSchema.safeParse(result.output)
      : readCurrentDocOutputSchema.safeParse(result.output)
    if (!parsed.success || parsed.data.status !== 'ok') {
      continue
    }

    const read = parsed.data
    const { document } = canonicalizeResultPermalink(read.doc.permalink, null, site)
    const evidence = reads.get(document) ?? {
      ref: read.doc.ref,
      title: read.doc.title,
      permalink: read.doc.permalink,
      sections: new Map<string, string | null>(),
      readWhole: false,
      crossPage: false
    }
    const section = selectedSection(read)
    if (section) {
      if (!evidence.sections.has(section.anchor)) {
        evidence.sections.set(section.anchor, section.heading)
      }
    } else {
      evidence.readWhole = true
    }
    evidence.crossPage ||= crossPage
    reads.set(document, evidence)
  }

  // Authorization and obligations are both derived once every result is in, so
  // they describe the turn's whole evidence rather than its first call.
  const obligations: DocumentationCitation[] = []
  for (const evidence of reads.values()) {
    const { target, section } = evidenceTarget(evidence, site)
    authorize(target)
    // Every section this turn actually selected stays clickable, even where the
    // generated citation is the document (two sections, or a whole read as well).
    for (const anchor of evidence.sections.keys()) {
      authorize(canonicalizeResultPermalink(evidence.permalink, anchor, site))
    }
    const citation: DocumentationCitation = {
      ref: evidence.ref,
      title: evidence.title,
      target,
      section,
      origin: evidence.crossPage ? 'read' : 'current'
    }
    eligible.push(citation)
    if (evidence.crossPage) {
      obligations.push(citation)
    }
  }

  return { obligations, searchFallback, eligible, authorizedTargets }
}

/** Whether a link may stay clickable. The single question the render policy asks. */
export const isAuthorizedTarget = (
  ledger: DocumentationCitationLedger,
  target: CanonicalDocumentationTarget
): boolean => ledger.authorizedTargets.has(targetKey(target))
