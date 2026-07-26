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
 * How many raw worker hits to ask for per requested result, initially.
 *
 * There is no fixed fan-out per page to compute this from: the plugin emits one
 * document per page title, description and keyword set, but one *per section*
 * for headings and content, so a single large page can occupy an unbounded
 * number of consecutive raw hits. Any fixed multiplier is therefore a guess,
 * and `fetchMappedPages` below re-queries with a larger limit when the guess
 * turns out too small.
 */
const RAW_HITS_PER_RESULT = 6
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

/** Nudges an offset forward to the next word boundary, so a window never starts mid-word. */
const snapToWordBoundary = (text: string, offset: number): number => {
  const nextSpace = text.slice(offset, offset + 40).search(/\s/)
  return nextSpace === -1 ? offset : offset + nextSpace + 1
}

/**
 * Builds a bounded, plain-text snippet that actually contains the match.
 *
 * The plugin indexes a whole section as one document, and those run to several
 * thousand characters — so simply truncating from the start routinely produced
 * a snippet containing none of the query terms, leaving an assistant with a
 * citation and no evidence for why it matched. The window is placed around the
 * first match instead (upstream's own search page does the equivalent with
 * `getStemmedPositions`), with ellipses marking any elision.
 *
 * Whitespace is collapsed only *after* slicing, since `ranges` are offsets into
 * the raw indexed text.
 */
const boundedSnippet = (text: string, ranges: readonly PrivateIndexMatchRange[]): string => {
  if (text.length <= MAX_SNIPPET_CHARS) return text.replace(/\s+/g, ' ').trim()

  const first = ranges[0]
  let start = 0
  if (first && first.start + first.length > MAX_SNIPPET_CHARS) {
    // Aim for `SNIPPET_LEAD_IN_CHARS` of context before the match, then pull the
    // window back if that would run past the end of the text (which would waste
    // budget on nothing).
    const aimed = Math.min(
      Math.max(0, first.start - SNIPPET_LEAD_IN_CHARS),
      Math.max(0, text.length - MAX_SNIPPET_CHARS)
    )
    // Never snap past the match itself; the lead-in is a nicety, showing the
    // match is the point.
    start = aimed > 0 ? Math.min(snapToWordBoundary(text, aimed), first.start) : 0
  }
  const end = Math.min(text.length, start + MAX_SNIPPET_CHARS)

  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

type MappedHit = { entry: CorpusRefMapEntry; hit: PrivateIndexSearchHit }

/**
 * Collapses raw worker hits to one per page, keeping **the first** hit each page
 * produced.
 *
 * The worker has already ranked its results, and a page's first hit is the one
 * it ranked highest for that page — so it is both the strongest match and the
 * one whose anchor/section describe why the page matched. Preferring a later,
 * lower-ranked hit because it happens to carry an anchor manufactures section
 * specificity the match does not support (and would compare raw lunr scores
 * across five independent indexes, which is not meaningful).
 */
const collapseToPages = (
  hits: readonly PrivateIndexSearchHit[],
  resolve: (url: string) => CorpusRefMapEntry | undefined
): Map<string, MappedHit> => {
  const byRef = new Map<string, MappedHit>()
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
  return byRef
}

type MappedPagesOutcome =
  | { ok: true; pages: Map<string, MappedHit> }
  | Extract<PrivateIndexOutcome, { ok: false }>

/**
 * Queries the worker with a progressively larger limit until enough distinct
 * eligible pages survive collapsing, the worker runs out of hits, or the safety
 * ceiling is reached. Re-querying is cheap: the worker's index is already
 * loaded and cached, and each pass is a superset of the previous one, so the
 * collapse is simply redone from scratch.
 */
const fetchMappedPages = async (
  siteConfig: SiteUrlConfig,
  query: string,
  limit: number,
  resolve: (url: string) => CorpusRefMapEntry | undefined
): Promise<MappedPagesOutcome> => {
  let rawLimit = Math.max(INITIAL_RAW_HITS, limit * RAW_HITS_PER_RESULT)

  for (;;) {
    const outcome = await searchPrivateWorker(siteConfig.baseUrl, query, rawLimit)
    if (!outcome.ok) return outcome

    const pages = collapseToPages(outcome.hits, resolve)
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
