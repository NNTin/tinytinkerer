/**
 * Wire contracts for the documentation retrieval API (issue #475).
 *
 * This is a TinyTinkerer-owned facade over Docusaurus' local search plugin
 * (`@easyops-cn/docusaurus-search-local`). No type here may leak that plugin's
 * private document/result shapes — the adapter that talks to the plugin lives
 * in apps/docs and normalizes into these contracts before anything else sees a
 * result. Keep this free of Docusaurus, React, and filesystem types so it can
 * be shared the same way as ./documentation-corpus.
 */

export type DocumentationSearchResult = {
  /** The #474 corpus ref (Docusaurus document id) the result was mapped to. */
  ref: string
  title: string
  /** Canonical, base-url-aware Docusaurus permalink — always a clickable citation target. */
  permalink: string
  /**
   * Section anchor (no leading `#`) for navigating straight to the match, or
   * null when the match was the page as a whole or the heading it belongs to
   * renders no anchor. Independent of `section`: a result can name its section
   * without being able to link to it.
   */
  anchor: string | null
  /**
   * Human-readable section/heading title the match belongs to (the enclosing
   * heading's text, or the page title when the match has no enclosing
   * heading), or null for a page-title match. Distinct from `anchor`, which
   * is a URL slug, not a display name — #477's `search_docs` tool surfaces
   * this directly to the assistant/user.
   */
  section: string | null
  /**
   * Bounded, plain-text preview centered on where the query actually matched,
   * with `…` marking elided text on either side. Not a leading excerpt: matches
   * routinely sit thousands of characters into a section, and a preview that
   * omitted them would give a caller no evidence for the citation.
   */
  snippet: string
}

/**
 * A successful query, including the zero-result case — an empty `results`
 * array here means the query legitimately matched nothing, which callers must
 * be able to tell apart from `DocumentationSearchFailure` below.
 *
 * `results` is ordered by relevance and is **prefix-stable in the requested
 * maximum**: asking for more results extends the list rather than reordering
 * it, so the same query at different limits agrees about its top citations.
 */
export type DocumentationSearchSuccess = {
  ok: true
  query: string
  results: DocumentationSearchResult[]
}

export type DocumentationSearchFailureCode =
  /** Non-production Docusaurus build: the upstream plugin never writes a search index outside `docusaurus build`. */
  | 'index_dev_unsupported'
  /**
   * Retrieval could not be *loaded*. Two distinguishable cases, both reported
   * with this code but with different `retryable` values, so check the flag
   * rather than assuming:
   *
   * - the search worker's code chunk failed to download — `retryable: true`;
   * - the search index itself failed to load — `retryable: false`, because the
   *   upstream worker memoizes that fetch (including a rejected one) for the
   *   lifetime of the page, so retrying in the same session replays the same
   *   failure. The message asks for a reload.
   *
   * A query that *ran* and failed is `index_incompatible`, not this.
   */
  | 'index_unavailable'
  /**
   * Retrieval loaded but did not behave as the adapter is pinned against:
   * either the search worker's response failed compatibility validation, or
   * executing the query inside it threw after the index had loaded
   * successfully. Never retryable — a reload reproduces it.
   */
  | 'index_incompatible'
  /** The #474 corpus manifest could not be fetched. */
  | 'manifest_unavailable'
  /** The fetched corpus manifest does not match the expected schema. */
  | 'manifest_incompatible'

export type DocumentationSearchFailure = {
  ok: false
  kind: 'documentation_search_failure'
  code: DocumentationSearchFailureCode
  message: string
  retryable: boolean
}

export type DocumentationSearchResponse = DocumentationSearchSuccess | DocumentationSearchFailure
