/**
 * Compatibility adapter around the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
 * local-search **worker** (issue #475). See ./README.md for the full rationale
 * (production-only index behavior, why the worker is reused rather than
 * reimplemented, the failure vocabulary, and the package-upgrade checklist) —
 * the notes below are only what's needed to follow this file itself.
 *
 * This is the only *production* module allowed to import that plugin's private,
 * unversioned internals (its ambient declaration and the contract test import
 * one more private module between them; see easyops-search-worker.d.ts). Every
 * export here returns a small, TinyTinkerer-owned shape
 * (`PrivateIndexSearchHit`) instead of the plugin's abbreviated document
 * fields (`i`/`t`/`u`/`p`/`h`/`s`/`b` — see scanDocuments.js in the pinned
 * version), its `DSLASearchResult` wrapper, or its lunr match metadata.
 * Nothing outside `apps/docs/src/docs-search` may import from
 * `@easyops-cn/docusaurus-search-local` — see search-documentation.ts for the
 * public entry point.
 *
 * Everything about *how* a query is run belongs to upstream, not to us:
 * tokenization, stop-word handling, trailing wildcards for partially-typed
 * terms, the `fuzzyMatchingDistance` matrix, `smartTerms`' 12-token cap, the
 * "leave one token out" relaxation at 3+ terms, iteration across the five
 * index groups, the `?_=<hash>` cache-busting index URL, and the final
 * `sortSearchResults`/`processTreeStatusOfSearchResults` ordering. This
 * adapter contributes exactly two things upstream does not: runtime validation
 * of the response contract, and normalization into a stable TinyTinkerer shape.
 */

/**
 * The plugin's `SearchDocumentType` ordinals (dist/client/shared/interfaces.js).
 * Redeclared rather than imported so that enum's runtime module never becomes
 * a second private dependency; the contract test pins these against the real
 * worker's output.
 */
const SEARCH_DOCUMENT_TYPE = {
  title: 0,
  heading: 1,
  description: 2,
  keywords: 3,
  content: 4
} as const

type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPE)[keyof typeof SEARCH_DOCUMENT_TYPE]

/**
 * Which optional fields `scanDocuments.js` emits for each document type. This
 * is a deliberately tight tripwire on a private wire format: a type that starts
 * carrying (or stops carrying) one of these is exactly the drift #475 asks this
 * boundary to diagnose, and `section`'s derivation below depends on it.
 *
 * - Title:               `{i, t, u, b}`        — whole page, no parent.
 * - Heading:             `{i, t, u, h, p}`     — `t` IS the section title.
 * - Description/Keywords `{i, t, s, u, p}`     — `s` is the page title.
 * - Content:             `{i, t, s, u, h, p}`  — `s` is the enclosing heading.
 *
 * `h` is optional on Heading/Content because `getTrimmedHash` returns
 * `undefined` for a section with no hash (it only skips the document outright
 * when the hash belongs to another page).
 */
const DOCUMENT_SHAPE: Record<
  SearchDocumentType,
  {
    parent: boolean
    section: boolean
    hash: 'required' | 'optional' | 'forbidden'
    breadcrumb: boolean
  }
> = {
  [SEARCH_DOCUMENT_TYPE.title]: {
    parent: false,
    section: false,
    hash: 'forbidden',
    breadcrumb: true
  },
  [SEARCH_DOCUMENT_TYPE.heading]: {
    parent: true,
    section: false,
    hash: 'optional',
    breadcrumb: false
  },
  [SEARCH_DOCUMENT_TYPE.description]: {
    parent: true,
    section: true,
    hash: 'forbidden',
    breadcrumb: false
  },
  [SEARCH_DOCUMENT_TYPE.keywords]: {
    parent: true,
    section: true,
    hash: 'forbidden',
    breadcrumb: false
  },
  [SEARCH_DOCUMENT_TYPE.content]: {
    parent: true,
    section: true,
    hash: 'optional',
    breadcrumb: false
  }
}

/**
 * Upstream also defines `AskAI = 5`, emitted only when
 * `searchLocalOptions.askAi` is configured. TinyTinkerer never configures it
 * (see docusaurus.config.ts), so a type outside `DOCUMENT_SHAPE` means the
 * plugin's document model changed under us — surfaced as `index_incompatible`
 * rather than silently mapped.
 */
const isKnownDocumentType = (type: number): type is SearchDocumentType =>
  Object.prototype.hasOwnProperty.call(DOCUMENT_SHAPE, type)

/**
 * The pinned plugin version this adapter's assumptions were read from. The
 * "pinned version" test compares this against `apps/docs/package.json`'s own
 * dependency entry — deliberately *our* manifest rather than the plugin's
 * private `package.json`, so the "only this module imports package internals"
 * rule stays mechanically true.
 */
export const PINNED_SEARCH_PLUGIN_VERSION = '0.55.2'

/**
 * The plugin's per-path search-context feature is off for this site
 * (`searchLocalOptions` sets no `searchContextByPaths`, so the generated
 * `searchContextByPaths` constant is `null`), and there are no versioned docs,
 * so the theme's own `versionUrl` reduces to the bare `baseUrl`. Passing the
 * same empty context the theme passes is what lets the worker's internal index
 * cache — keyed on `${baseUrl}${searchContext}` — be shared with the search
 * bar instead of fetching a second copy of the index.
 */
const SEARCH_CONTEXT = ''

/**
 * The plugin indexes exactly one field, `t` (see buildIndex.js's `field("t")`),
 * and whitelists exactly one metadata key, `position`. Match offsets are
 * therefore always found under `metadata[stemmedTerm].t.position`.
 */
const INDEXED_FIELD = 't'

const RELOAD_GUIDANCE =
  'The pinned search worker caches this failure for the lifetime of the page; reload the page to try again.'

const UPGRADE_HINT =
  'This usually means @easyops-cn/docusaurus-search-local was upgraded — see the upgrade checklist in apps/docs/src/docs-search/README.md.'

/**
 * The plugin's abbreviated document record (scanDocuments.js). Only the fields
 * this adapter validates and reads are named; nothing below leaves this module.
 */
type RawDocumentRecord = {
  i: number
  t: string
  u: string
  p?: number
  h?: string
  s?: string
  b?: string[]
}

/**
 * Where a query term matched inside a hit's `matchedText`, as a half-open
 * `[start, start + length)` character range. Normalized from the plugin's lunr
 * match metadata so callers can build a snippet that actually contains the
 * match — a long indexed section can easily match thousands of characters in,
 * and truncating from the start would return a snippet showing none of it.
 *
 * Ordered the way the plugin's own `getStemmedPositions` orders them: earliest
 * start first, longest match first on a tie.
 */
export type PrivateIndexMatchRange = { start: number; length: number }

export type PrivateIndexSearchHit = {
  /** The page's Docusaurus route (base-url aware), matching a #474 corpus permalink. */
  url: string
  /** Section anchor with no leading `#`, or null when the match was the page title itself. */
  anchor: string | null
  /**
   * Human-readable section/heading title (see `deriveSection`): a Heading
   * record's own `t`, a Description/Keywords/Content record's `s` (the
   * enclosing heading's title, or the page title if there isn't one), or
   * null for a Title (whole-page) record. Independent of `anchor` — a heading
   * with no rendered hash still has a name.
   */
  section: string | null
  /** Raw indexed text for the matching field — the snippet source. */
  matchedText: string
  /** Where the query matched inside `matchedText`; always at least one range. */
  matchRanges: PrivateIndexMatchRange[]
}

export type PrivateIndexFailureCode =
  | 'index_dev_unsupported'
  | 'index_unavailable'
  | 'index_incompatible'

export type PrivateIndexOutcome =
  | { ok: true; hits: PrivateIndexSearchHit[] }
  | { ok: false; code: PrivateIndexFailureCode; message: string; retryable: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isDocumentId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/**
 * Validates the plugin's abbreviated document record against the per-type shape
 * `scanDocuments.js` emits. `shape` is omitted for a parent page record, which
 * is always a Title document reached through `document.p` rather than through
 * its own result entry.
 */
const validateDocumentRecord = (
  value: unknown,
  shape: (typeof DOCUMENT_SHAPE)[SearchDocumentType]
): value is RawDocumentRecord => {
  if (!isRecord(value)) return false
  if (!isDocumentId(value.i) || typeof value.t !== 'string' || typeof value.u !== 'string') {
    return false
  }
  if (shape.parent ? !isDocumentId(value.p) : value.p !== undefined) return false
  if (shape.section ? typeof value.s !== 'string' : value.s !== undefined) return false
  if (shape.hash === 'forbidden' && value.h !== undefined) return false
  if (shape.hash === 'required' && typeof value.h !== 'string') return false
  if (shape.hash === 'optional' && value.h !== undefined && typeof value.h !== 'string')
    return false
  // Required, not merely well-typed-if-present: `parseDocument.js` and
  // `parsePage.js` both initialise `breadcrumb` to `[]` and always return it, so
  // a Title record without `b` is drift rather than an upstream variation. (An
  // empty array is normal and passes.) The fresh production index carries `b` on
  // all 26 Title records.
  if (shape.breadcrumb ? !isStringArray(value.b) : value.b !== undefined) return false
  return true
}

/**
 * The human-readable section title for a hit, keyed off the document *type*
 * rather than off which optional fields happen to be populated — see
 * `DOCUMENT_SHAPE` for where each type keeps it.
 *
 * Deriving it from field presence instead (`doc.s ?? (doc.h ? doc.t : null)`)
 * silently lost the section for a real case: the production index contains
 * Heading records with `h: ""`, for rendered headings Docusaurus gives no
 * anchor. A Heading's own `t` is its section title whether or not navigation can
 * target it, so those pages reported `section: null` while `anchor: null` was
 * correct.
 */
const deriveSection = (type: SearchDocumentType, doc: RawDocumentRecord): string | null => {
  if (type === SEARCH_DOCUMENT_TYPE.title) return null
  if (type === SEARCH_DOCUMENT_TYPE.heading) return doc.t
  return doc.s ?? null
}

/**
 * Normalizes lunr's match metadata into `PrivateIndexMatchRange[]`.
 *
 * The structure being read is `metadata[stemmedTerm][field].position`, an array
 * of `[start, length]` pairs — see the plugin's own `getStemmedPositions`, which
 * this mirrors including its ordering.
 *
 * At least one valid range is **required**. For this pinned implementation that
 * is provable rather than merely likely: `buildIndex.js` indexes exactly one
 * field (`t`) and sets `metadataWhitelist = ["position"]`, so a positive lunr
 * result necessarily matched that field and necessarily carries its offsets,
 * and the worker forwards match metadata unchanged. A result without them means
 * the wire contract changed or the payload is corrupt — and accepting it
 * silently would reintroduce exactly the defect the match-centered snippet
 * exists to fix, since a long section would quietly fall back to a leading
 * window containing none of the query evidence.
 */
const normalizeMatchRanges = (
  metadata: unknown,
  text: string
): { ok: true; ranges: PrivateIndexMatchRange[] } | { ok: false; message: string } => {
  if (!isRecord(metadata)) return { ok: false, message: 'match metadata is not an object' }

  const ranges: PrivateIndexMatchRange[] = []
  for (const perTerm of Object.values(metadata)) {
    if (!isRecord(perTerm)) return { ok: false, message: 'a match metadata entry is not an object' }
    const perField = perTerm[INDEXED_FIELD]
    if (perField === undefined) continue
    if (!isRecord(perField)) {
      return { ok: false, message: `match metadata field "${INDEXED_FIELD}" is not an object` }
    }
    const { position } = perField
    if (!Array.isArray(position)) {
      return { ok: false, message: 'match metadata carries no position array' }
    }
    for (const entry of position) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        return { ok: false, message: 'a match position is not a [start, length] pair' }
      }
      const [start, length] = entry as unknown[]
      if (
        typeof start !== 'number' ||
        typeof length !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(length) ||
        start < 0 ||
        length <= 0 ||
        start + length > text.length
      ) {
        return {
          ok: false,
          message: `match position [${String(start)}, ${String(length)}] does not fall inside the ${text.length}-character indexed text`
        }
      }
      ranges.push({ start, length })
    }
  }

  if (ranges.length === 0) {
    return {
      ok: false,
      message: `match metadata reports no "${INDEXED_FIELD}" field positions, which the pinned index always records for a positive result`
    }
  }

  // Same ordering as getStemmedPositions: earliest first, longest first on a tie.
  ranges.sort((a, b) => a.start - b.start || b.length - a.length)
  return { ok: true, ranges }
}

/**
 * Validates one entry of the worker's response against the pinned contract and
 * normalizes it. This is issue #475's "pinned compatibility fixture" surface:
 * upstream's `SearchWorker.search` builds each result with a bare
 * `documents.find(...)` and **no** runtime check, so a serialized lunr index
 * whose refs have drifted from its own `documents[]` silently yields
 * `document: undefined` and a plausible-looking empty result. Rejecting that
 * here is what turns private contract drift into an actionable diagnosis
 * instead of a confidently wrong answer.
 */
const normalizeWorkerResult = (
  value: unknown,
  order: number
): { ok: true; hit: PrivateIndexSearchHit } | { ok: false; message: string } => {
  if (!isRecord(value)) {
    return { ok: false, message: `result ${order} is not an object` }
  }

  const { type, document, page, score, tokens, metadata } = value
  if (typeof type !== 'number' || !Number.isInteger(type)) {
    return { ok: false, message: `result ${order} has a non-integer document type` }
  }
  if (!isKnownDocumentType(type)) {
    return {
      ok: false,
      message: `result ${order} has document type ${type}, outside the five index groups this site configures (it never enables an AskAI group)`
    }
  }

  const shape = DOCUMENT_SHAPE[type]
  if (!validateDocumentRecord(document, shape)) {
    return {
      ok: false,
      message:
        document === undefined
          ? `result ${order} (type ${type}) carries no document — the serialized lunr index matched a ref that is absent from its own documents[]`
          : `result ${order} (type ${type}) has a document that does not match the field shape scanDocuments.js emits for that type`
    }
  }

  // Upstream sets `page` to `false` for a Title result, and otherwise looks the
  // parent page's Title document up by `document.p`. A missing parent, a parent
  // whose id contradicts `document.p`, or a parent on a *different page* is the
  // same class of index/document drift as an unknown ref above — and the last
  // one is the dangerous kind, because the hit's text would end up cited
  // against another page's corpus ref.
  if (type === SEARCH_DOCUMENT_TYPE.title) {
    if (page !== false) {
      return { ok: false, message: `result ${order} is a page title but carries a parent page` }
    }
  } else if (!validateDocumentRecord(page, DOCUMENT_SHAPE[SEARCH_DOCUMENT_TYPE.title])) {
    return {
      ok: false,
      message: `result ${order} (type ${type}) has no resolvable parent page document for p=${String(document.p)}`
    }
  } else if (page.i !== document.p) {
    return {
      ok: false,
      message: `result ${order} (type ${type}) resolved parent page ${page.i}, but its own document declares p=${String(document.p)}`
    }
  } else if (page.u !== document.u) {
    return {
      ok: false,
      message: `result ${order} (type ${type}) belongs to parent page "${page.u}" but carries URL "${document.u}"`
    }
  }

  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { ok: false, message: `result ${order} has a non-finite score` }
  }
  // Unused here (upstream's own highlighting consumes it), but a cheap tripwire
  // for the response contract changing shape.
  if (!isStringArray(tokens)) {
    return { ok: false, message: `result ${order} has no matched-token list` }
  }

  const normalizedRanges = normalizeMatchRanges(metadata, document.t)
  if (!normalizedRanges.ok) {
    return { ok: false, message: `result ${order} (type ${type}): ${normalizedRanges.message}` }
  }

  return {
    ok: true,
    hit: {
      url: document.u,
      anchor: document.h ? document.h.replace(/^#/, '') : null,
      section: deriveSection(type, document),
      matchedText: document.t,
      matchRanges: normalizedRanges.ranges
    }
  }
}

type SearchByWorkerModule =
  typeof import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js')

let workerModule: Promise<SearchByWorkerModule> | undefined

/**
 * Deliberately a lazy, memoized dynamic import rather than a static one. A
 * static import would pull the plugin's worker chunk into the entry bundle of
 * every page that imports this module, which issue #475 rules out ("No search
 * worker or index is loaded merely by opening a documentation page or the
 * assistant"). The specifier resolves to the same module the plugin's own
 * SearchBar.jsx and SearchPage.jsx import, so webpack serves both from one
 * module instance and the `Worker` that module creates on first use is shared,
 * not duplicated.
 *
 * A failed import (a code-split chunk that didn't download) is *not* memoized:
 * unlike the worker's internal index cache, this one is ours, so a later call
 * gets a genuinely fresh attempt.
 */
const loadSearchByWorker = (): Promise<SearchByWorkerModule> => {
  if (!workerModule) {
    const pending =
      import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js')
    workerModule = pending
    void pending.catch(() => {
      if (workerModule === pending) workerModule = undefined
    })
  }
  return workerModule
}

/** Test-only: drops the memoized module import so the next call re-imports it. */
export const resetSearchWorkerModuleCacheForTests = (): void => {
  workerModule = undefined
}

/**
 * Runs one query through the pinned plugin's own search worker and returns
 * normalized hits **in the worker's order**. Callers are expected to request
 * more hits than they need (the plugin emits a separate document per page
 * title, description, keyword set, heading and content section) and to collapse
 * them to one result per page themselves — see search-documentation.ts.
 */
export const searchPrivateWorker = async (
  baseUrl: string,
  query: string,
  limit: number
): Promise<PrivateIndexOutcome> => {
  if (process.env.NODE_ENV !== 'production') {
    // Upstream's own `searchByWorker` returns `[]` outside a production build
    // (the index is only written by the Webpack postBuild hook), which would be
    // indistinguishable from a query that legitimately matched nothing.
    return {
      ok: false,
      code: 'index_dev_unsupported',
      message:
        'The local search index is generated only by `docusaurus build` (see postBuildFactory.js); it does not exist in a development server.',
      retryable: false
    }
  }

  let module: SearchByWorkerModule
  try {
    module = await loadSearchByWorker()
  } catch (error) {
    return {
      ok: false,
      code: 'index_unavailable',
      message: `the documentation search worker chunk could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
      retryable: true
    }
  }

  // Index initialization is driven separately from the query — the same split
  // the plugin's own SearchPage uses — because only this step is subject to the
  // worker's permanent failure memoization, and only this step's failure
  // justifies telling the caller to reload.
  try {
    await module.fetchIndexesByWorker(baseUrl, SEARCH_CONTEXT)
  } catch (error) {
    // Not retryable *within this page session*: `SearchWorker.lowLevelFetchIndexes`
    // stores its fetch promise in a module-level Map *before* awaiting it, so a
    // rejected fetch is replayed to every later caller. That cache lives inside
    // the worker and cannot be evicted from here, and reporting this as
    // retryable would only invite futile retry loops.
    return {
      ok: false,
      code: 'index_unavailable',
      message: `the documentation search worker failed to load the search index: ${
        error instanceof Error ? error.message : String(error)
      }. ${RELOAD_GUIDANCE}`,
      retryable: false
    }
  }

  let results: unknown[]
  try {
    results = await module.searchByWorker(baseUrl, SEARCH_CONTEXT, query, limit)
  } catch (error) {
    // The index loaded, so this is not the memoized failure above and a reload
    // would not help. What threw is the worker's own tokenize/query/sort path,
    // which is precisely the private behavior this adapter is pinned against.
    return {
      ok: false,
      code: 'index_incompatible',
      message: `the search index loaded, but executing the query inside the pinned worker threw: ${
        error instanceof Error ? error.message : String(error)
      }. ${UPGRADE_HINT}`,
      retryable: false
    }
  }

  if (!Array.isArray(results)) {
    return {
      ok: false,
      code: 'index_incompatible',
      message: `the search worker returned ${typeof results} instead of an array of results. ${UPGRADE_HINT}`,
      retryable: false
    }
  }

  const hits: PrivateIndexSearchHit[] = []
  for (const [order, result] of results.entries()) {
    const normalized = normalizeWorkerResult(result, order)
    if (!normalized.ok) {
      return {
        ok: false,
        code: 'index_incompatible',
        message: `the search worker's response failed compatibility validation: ${normalized.message}. ${UPGRADE_HINT}`,
        retryable: false
      }
    }
    hits.push(normalized.hit)
  }

  return { ok: true, hits }
}
