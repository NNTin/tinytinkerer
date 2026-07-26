/**
 * Public entry point for the documentation retrieval API (issue #475).
 *
 * Composes the private-worker compatibility adapter (private-worker-adapter.ts)
 * with the #474 corpus ref mapper (corpus-ref-map.ts) into the shared
 * `DocumentationSearchResponse` contract
 * (packages/shared/contracts/src/documentation-search.ts). This is the only
 * function future assistant tools (#477) should call — neither of the two
 * modules it composes is meant to be used directly outside this file.
 */
import type {
  DocumentationSearchResponse,
  DocumentationSearchResult
} from '@tinytinkerer/app-browser'
import { type CorpusRefMapEntry, loadCorpusRefMap, type SiteUrlConfig } from './corpus-ref-map'
import { type PrivateIndexSearchHit, searchPrivateWorker } from './private-worker-adapter'

const DEFAULT_MAX_RESULTS = 8
const MAX_MAX_RESULTS = 20
const MAX_SNIPPET_CHARS = 300

// The private index fans one page out into up to five separate hits (title,
// heading, description, keywords, content — see buildIndex.js). We ask for
// more raw hits than `maxResults` so enough distinct PAGES survive collapsing
// those fan-out hits into one result per page (see the dedup loop below).
const RAW_HITS_PER_RESULT = 6
const MIN_RAW_HITS = 40

const clampMaxResults = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.min(MAX_MAX_RESULTS, Math.max(1, Math.floor(value)))
}

const boundedSnippet = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_SNIPPET_CHARS
    ? `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`
    : collapsed
}

/**
 * Picks which of a page's hits represents it, once the plugin's five index
 * groups have been collapsed to one result per page.
 *
 * #475 asks for two things at once here: retain the *best matching section*,
 * and give section matches *a valid anchor when available*. So a hit that
 * carries an anchor always beats the page-title hit (which by construction has
 * none and would cite the top of the page); among anchored hits the higher raw
 * lunr score wins, with the worker's own ordering breaking ties. A page-title
 * hit is only used when it is all the page produced.
 *
 * Note this deliberately does not re-rank *pages* — see the ordering comment in
 * `searchDocumentation`.
 */
const isBetterHitForPage = (
  candidate: PrivateIndexSearchHit,
  incumbent: PrivateIndexSearchHit
): boolean => {
  const candidateAnchored = candidate.anchor !== null
  const incumbentAnchored = incumbent.anchor !== null
  if (candidateAnchored !== incumbentAnchored) return candidateAnchored
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score
  return candidate.order < incumbent.order
}

/**
 * Searches the production-only local search index and returns unique,
 * #474-cited documentation results. `siteConfig.baseUrl` must be the site's
 * configured Docusaurus `baseUrl`, and `siteConfig.trailingSlash` its
 * configured `trailingSlash` (both from `useDocusaurusContext().siteConfig`)
 * — both are needed to normalize a raw search hit's URL against the #474
 * corpus manifest's canonical permalinks.
 */
export const searchDocumentation = async (
  siteConfig: SiteUrlConfig,
  query: string,
  maxResults?: number
): Promise<DocumentationSearchResponse> => {
  const trimmedQuery = query.trim()
  const limit = clampMaxResults(maxResults)
  const internalLimit = Math.max(MIN_RAW_HITS, limit * RAW_HITS_PER_RESULT)

  const [indexOutcome, refMapOutcome] = await Promise.all([
    searchPrivateWorker(siteConfig.baseUrl, trimmedQuery, internalLimit),
    loadCorpusRefMap(siteConfig)
  ])

  if (!indexOutcome.ok) {
    return {
      ok: false,
      kind: 'documentation_search_failure',
      code: indexOutcome.code,
      message: indexOutcome.message,
      retryable: indexOutcome.retryable
    }
  }
  if (!refMapOutcome.ok) {
    return {
      ok: false,
      kind: 'documentation_search_failure',
      code: refMapOutcome.code,
      message: refMapOutcome.message,
      retryable: refMapOutcome.retryable
    }
  }

  // Page order is the order pages first appear in the worker's results, which
  // upstream has already ranked (sortSearchResults +
  // processTreeStatusOfSearchResults). Re-sorting by raw lunr score here would
  // silently diverge from the site's own /search page, because those scores
  // come from five independent lunr indexes and are not comparable across
  // them — `Map` preserves insertion order, so iterating hits in worker order
  // is all that's needed.
  const bestByRef = new Map<string, { entry: CorpusRefMapEntry; hit: PrivateIndexSearchHit }>()
  for (const hit of indexOutcome.hits) {
    const entry = refMapOutcome.resolve(hit.url)
    // Drop rather than invent a ref: an unmapped URL means the search index
    // points at a route the #474 corpus doesn't recognise (e.g. it isn't the
    // canonical docs version — see selectCanonicalCorpusVersion in
    // docs-corpus/plugin.ts). Also re-enforce the plugin's own "unlisted
    // pages are excluded from global search" rule defensively, in case an
    // unlisted page ever slips into the index.
    if (!entry || entry.unlisted) continue
    const existing = bestByRef.get(entry.ref)
    if (!existing || isBetterHitForPage(hit, existing.hit)) {
      bestByRef.set(entry.ref, { entry, hit })
    }
  }

  // `Array.from`, not `[...bestByRef.values()]`: Docusaurus' Webpack/Babel
  // browser targets compile an array-literal spread down to
  // `[].concat(iterator)`, which wraps the Map iterator in a one-element array
  // instead of expanding it. Verified against a real production build.
  const results: DocumentationSearchResult[] = Array.from(bestByRef.values())
    .slice(0, limit)
    .map(({ entry, hit }) => ({
      ref: entry.ref,
      title: entry.title,
      permalink: entry.permalink,
      anchor: hit.anchor,
      section: hit.section,
      snippet: boundedSnippet(hit.matchedText)
    }))

  return { ok: true, query: trimmedQuery, results }
}
