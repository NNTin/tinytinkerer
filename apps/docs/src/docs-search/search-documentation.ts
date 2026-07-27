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
import {
  type PrivateIndexMatchRange,
  type PrivateIndexOutcome,
  type PrivateIndexSearchHit,
  searchPrivateWorker
} from './private-worker-adapter'

const DEFAULT_MAX_RESULTS = 8
const MAX_MAX_RESULTS = 20

const MAX_SNIPPET_CHARS = 300
// How much of the snippet budget is spent on context *before* the first match,
// so a match deep inside a long section is shown in context rather than at the
// very start of the window.
const SNIPPET_LEAD_IN_CHARS = 60

/**
 * The raw worker limit every search starts from — a **constant**, deliberately
 * independent of `maxResults`.
 *
 * The pinned worker is not monotonic in its `limit`: it fills the requested
 * limit while iterating smart-query tiers and index groups, breaks as soon as
 * that limit is full, and only *then* sorts. A larger limit can therefore admit
 * a page's title during a later relaxed tier, which pulls that page's already-
 * admitted section hit down beside it (`sortSearchResults` keys a section on the
 * index of its page's title). So a bigger run is neither a set superset nor a
 * stable prefix of a smaller one.
 *
 * Deriving the first limit from `maxResults` therefore made the *public* result
 * order depend on how many results the caller asked for: on the production
 * index, `searchDocumentation(…, 'app', 6)` and `(…, 'app', 20)` disagreed about
 * the top citations. Starting every search from the same window, and only ever
 * appending newly-seen pages on expansion (see `fetchMappedPages`), makes
 * `results(N)` a prefix of `results(M > N)` by construction — without needing
 * the worker to be well-behaved.
 */
const INITIAL_RAW_HITS = 40
/**
 * Ceiling on the over-fetch loop. The worker slices each query's results to the
 * limit it is given, so a larger limit costs proportionally more work on the
 * worker thread; past this point returning fewer results than requested is
 * better than spending unbounded effort on a query the corpus cannot satisfy.
 */
const MAX_RAW_HITS = 480

const clampMaxResults = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.min(MAX_MAX_RESULTS, Math.max(1, Math.floor(value)))
}

/**
 * How far a window edge may travel to reach whitespace before giving up and
 * cutting mid-token. Long code identifiers and URLs genuinely have no boundary
 * nearby, and losing a big slice of an already-small budget to chase one is
 * worse than an honest mid-token cut.
 */
const WORD_BOUNDARY_SEARCH_CHARS = 24

/**
 * Moves an offset forward to just after the next whitespace, or returns
 * `undefined` when there is none within `WORD_BOUNDARY_SEARCH_CHARS`. Callers
 * decide what to do with that, rather than being handed a silently unsnapped
 * (mid-token) offset dressed up as a word boundary.
 */
const snapStartForward = (text: string, offset: number): number | undefined => {
  const found = text.slice(offset, offset + WORD_BOUNDARY_SEARCH_CHARS).search(/\s/)
  return found === -1 ? undefined : offset + found + 1
}

/** As above, but moving an end offset backward to the whitespace before it. */
const snapEndBackward = (text: string, offset: number): number | undefined => {
  const window = text.slice(Math.max(0, offset - WORD_BOUNDARY_SEARCH_CHARS), offset)
  const found = window.search(/\s\S*$/)
  return found === -1 ? undefined : Math.max(0, offset - WORD_BOUNDARY_SEARCH_CHARS) + found
}

/**
 * Builds a bounded, plain-text snippet centered on where the query matched.
 *
 * The plugin indexes a whole section as one document, and those run to several
 * thousand characters — so truncating from the start routinely produced a
 * snippet containing none of the query terms, leaving an assistant with a
 * citation and no evidence for why it matched. The window is placed around the
 * first match instead (upstream's own search page does the equivalent with
 * `getStemmedPositions`), with ellipses marking any elision.
 *
 * Centering applies to **every** oversized text, not only when the match falls
 * outside a leading window. A match ending at, say, character 300 of a 3,000
 * character section is inside a leading window — but only barely, with the whole
 * budget spent ahead of it and the explanation that follows it cut off. Both
 * edges are also nudged to word boundaries where one is close enough.
 *
 * Whitespace is collapsed only *after* slicing, since `ranges` are offsets into
 * the raw indexed text.
 */
const boundedSnippet = (text: string, ranges: readonly PrivateIndexMatchRange[]): string => {
  if (text.length <= MAX_SNIPPET_CHARS) return text.replace(/\s+/g, ' ').trim()

  const first = ranges[0]
  // Aim for `SNIPPET_LEAD_IN_CHARS` of context before the match, clamped so the
  // window neither starts before the text nor runs past its end (which would
  // spend budget on nothing).
  const lastPossibleStart = text.length - MAX_SNIPPET_CHARS
  const aimed = first
    ? Math.min(Math.max(0, first.start - SNIPPET_LEAD_IN_CHARS), lastPossibleStart)
    : 0

  // Never snap past the match itself; the lead-in is a nicety, showing the match
  // is the point.
  const snappedStart = aimed > 0 ? snapStartForward(text, aimed) : undefined
  const start =
    snappedStart === undefined ? aimed : Math.min(snappedStart, first ? first.start : aimed)

  const aimedEnd = Math.min(text.length, start + MAX_SNIPPET_CHARS)
  const matchEnd = first ? first.start + first.length : 0
  const snappedEnd = aimedEnd < text.length ? snapEndBackward(text, aimedEnd) : undefined
  // Snapping the trailing edge must not eat the match, and must leave a snippet
  // worth reading.
  const end =
    snappedEnd !== undefined && snappedEnd > Math.max(matchEnd, start + MAX_SNIPPET_CHARS / 2)
      ? snappedEnd
      : aimedEnd

  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

type MappedHit = { entry: CorpusRefMapEntry; hit: PrivateIndexSearchHit }

/**
 * Folds one pass of raw worker hits into the accumulated page map, **appending
 * only pages not already seen** and never replacing an existing page's
 * representative hit.
 *
 * Two rules are doing work here.
 *
 * Within a pass, a page is represented by its first hit: the worker has already
 * ranked its results, so a page's first hit is the one it ranked highest for
 * that page, and the one whose anchor/section describe why the page matched.
 * Preferring a later, lower-ranked hit because it happens to carry an anchor
 * manufactures section specificity the match does not support (and would compare
 * raw lunr scores across five independent indexes, which is not meaningful).
 *
 * Across passes, append-only is what makes the public result order stable under
 * `maxResults`, given a worker that is not monotonic in its own limit — see
 * `INITIAL_RAW_HITS`. Recomputing the map from each larger pass would let an
 * expansion reorder or drop pages the caller had already been shown.
 */
const accumulatePages = (
  byRef: Map<string, MappedHit>,
  hits: readonly PrivateIndexSearchHit[],
  resolve: (url: string) => CorpusRefMapEntry | undefined
): void => {
  for (const hit of hits) {
    const entry = resolve(hit.url)
    // Drop rather than invent a ref: an unmapped URL means the search index
    // points at a route the #474 corpus doesn't recognise (e.g. it isn't the
    // canonical docs version — see selectCanonicalCorpusVersion in
    // docs-corpus/plugin.ts). Also re-enforce the plugin's own "unlisted
    // pages are excluded from global search" rule defensively, in case an
    // unlisted page ever slips into the index.
    if (!entry || entry.unlisted) continue
    if (!byRef.has(entry.ref)) byRef.set(entry.ref, { entry, hit })
  }
}

type MappedPagesOutcome =
  | { ok: true; pages: Map<string, MappedHit> }
  | Extract<PrivateIndexOutcome, { ok: false }>

/**
 * Queries the worker from a fixed starting window, expanding it until enough
 * distinct eligible pages have accumulated, the worker runs out of hits, or the
 * safety ceiling is reached. Re-querying is cheap: the worker's index is already
 * loaded and cached.
 *
 * Expansion is append-only rather than a fresh collapse, because the worker is
 * not monotonic in `limit` — see `INITIAL_RAW_HITS` for what that means and why
 * this shape is what gives the public API a `results(N) ⊑ results(M > N)`
 * guarantee.
 */
const fetchMappedPages = async (
  siteConfig: SiteUrlConfig,
  query: string,
  limit: number,
  resolve: (url: string) => CorpusRefMapEntry | undefined
): Promise<MappedPagesOutcome> => {
  const pages = new Map<string, MappedHit>()
  let rawLimit = INITIAL_RAW_HITS

  for (;;) {
    const outcome = await searchPrivateWorker(siteConfig.baseUrl, query, rawLimit)
    if (!outcome.ok) return outcome

    accumulatePages(pages, outcome.hits, resolve)
    if (pages.size >= limit) return { ok: true, pages }
    // The worker slices to the limit it was given, so a short response means it
    // has nothing more to give and a larger limit cannot help.
    if (outcome.hits.length < rawLimit) return { ok: true, pages }
    if (rawLimit >= MAX_RAW_HITS) return { ok: true, pages }
    rawLimit = Math.min(MAX_RAW_HITS, rawLimit * 2)
  }
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

  const refMapOutcome = await loadCorpusRefMap(siteConfig)
  if (!refMapOutcome.ok) {
    return {
      ok: false,
      kind: 'documentation_search_failure',
      code: refMapOutcome.code,
      message: refMapOutcome.message,
      retryable: refMapOutcome.retryable
    }
  }

  const searchOutcome = await fetchMappedPages(
    siteConfig,
    trimmedQuery,
    limit,
    refMapOutcome.resolve
  )
  if (!searchOutcome.ok) {
    return {
      ok: false,
      kind: 'documentation_search_failure',
      code: searchOutcome.code,
      message: searchOutcome.message,
      retryable: searchOutcome.retryable
    }
  }

  // Page order is the order pages first appear in the worker's results, which
  // upstream has already ranked (sortSearchResults +
  // processTreeStatusOfSearchResults). Re-sorting by raw lunr score here would
  // silently diverge from the site's own /search page, because those scores
  // come from five independent lunr indexes and are not comparable across
  // them — `Map` preserves insertion order, so nothing further is needed.
  //
  // `Array.from`, not `[...pages.values()]`: Docusaurus' Webpack/Babel browser
  // targets compile an array-literal spread down to `[].concat(iterator)`,
  // which wraps the Map iterator in a one-element array instead of expanding
  // it. Verified against a real production build.
  const results: DocumentationSearchResult[] = Array.from(searchOutcome.pages.values())
    .slice(0, limit)
    .map(({ entry, hit }) => ({
      ref: entry.ref,
      title: entry.title,
      permalink: entry.permalink,
      anchor: hit.anchor,
      section: hit.section,
      snippet: boundedSnippet(hit.matchedText, hit.matchRanges)
    }))

  return { ok: true, query: trimmedQuery, results }
}
