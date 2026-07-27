/**
 * Maps a documentation-search hit's page URL back to a #474 corpus ref.
 *
 * This module knows nothing about the private search plugin, and nothing about
 * fetching either: it is a thin canonical-version projection over the shared
 * runtime corpus store (`docs-corpus/manifest-store.ts`), which owns locator
 * discovery, full-contract validation, integrity verification, caching and
 * retry for every documentation consumer. #477's `read_doc` reaches the *same*
 * store for the same entries' `artifact` when a search result's `ref` is handed
 * straight to it, so neither side can develop its own idea of what the corpus
 * is.
 */
import {
  loadDocumentationCorpusStore,
  type DocumentationCorpusStoreFailureCode,
  type SiteUrlConfig
} from '../docs-corpus/manifest-store'

export type { SiteUrlConfig }

/**
 * Only the manifest-entry fields the search path actually consumes. Deliberately
 * narrower than the full `DocumentationCorpusManifestEntry` the store validates
 * and hands to #477 — `search-documentation.ts` has no business reading a
 * document's artifact URL or hashes, and this keeps that visible in the types.
 */
export type CorpusRefMapEntry = {
  ref: string
  title: string
  permalink: string
  unlisted: boolean
}

export type CorpusRefMapFailureCode = DocumentationCorpusStoreFailureCode

export type CorpusRefMapOutcome =
  | { ok: true; resolve: (url: string) => CorpusRefMapEntry | undefined }
  | { ok: false; code: CorpusRefMapFailureCode; message: string; retryable: boolean }

export const loadCorpusRefMap = async (siteConfig: SiteUrlConfig): Promise<CorpusRefMapOutcome> => {
  const outcome = await loadDocumentationCorpusStore(siteConfig)
  if (!outcome.ok) return outcome
  return { ok: true, resolve: (url) => outcome.store.findByPermalink(url) }
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing a cached promise. */
export { resetDocumentationCorpusStoreForTests as resetCorpusRefMapCacheForTests } from '../docs-corpus/manifest-store'
