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
  /** Section anchor (no leading `#`) when the best match was a specific section, else null. */
  anchor: string | null
  /** Bounded, plain-text preview of the best matching section. */
  snippet: string
}

/**
 * A successful query, including the zero-result case — an empty `results`
 * array here means the query legitimately matched nothing, which callers must
 * be able to tell apart from `DocumentationSearchFailure` below.
 */
export type DocumentationSearchSuccess = {
  ok: true
  query: string
  results: DocumentationSearchResult[]
}

export type DocumentationSearchFailureCode =
  /** Non-production Docusaurus build: the upstream plugin never writes a search index outside `docusaurus build`. */
  | 'index_dev_unsupported'
  /** The search index asset could not be fetched (network/HTTP failure); may succeed on retry. */
  | 'index_unavailable'
  /** The fetched search index does not match the shape this adapter was pinned against. */
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
