/**
 * Compatibility adapter around the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
 * local-search **worker** (issue #475). See ./README.md for the full rationale
 * (production-only index behavior, why the worker is reused rather than
 * reimplemented, the failure vocabulary, and the package-upgrade checklist) —
 * the notes below are only what's needed to follow this file itself.
 *
 * This is the ONLY module allowed to import that plugin's private, unversioned
 * internals. Every export here returns a small, TinyTinkerer-owned shape
 * (`PrivateIndexSearchHit`) instead of the plugin's abbreviated document
 * fields (`i`/`t`/`u`/`p`/`h`/`s`/`b` — see scanDocuments.js in the pinned
 * version) or its `DSLASearchResult` wrapper. Nothing outside
 * `apps/docs/src/docs-search` may import from
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

/**
 * Upstream also defines `AskAI = 5`, emitted only when
 * `searchLocalOptions.askAi` is configured. TinyTinkerer never configures it
 * (see docusaurus.config.ts), so a type outside this range means the plugin's
 * document model changed under us — surfaced as `index_incompatible` rather
 * than silently mapped.
 */
const MAX_SEARCH_DOCUMENT_TYPE = SEARCH_DOCUMENT_TYPE.content

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

export type PrivateIndexSearchHit = {
  /** The page's Docusaurus route (base-url aware), matching a #474 corpus permalink. */
  url: string
  /** Section anchor with no leading `#`, or null when the match was the page title itself. */
  anchor: string | null
  /**
   * Human-readable section/heading title (see scanDocuments.js): a Heading
   * record's own `t`, a Description/Keywords/Content record's `s` (the
   * enclosing heading's title, or the page title if there isn't one), or
   * null for a Title (whole-page) record.
   */
  section: string | null
  /** Raw indexed text for the matching field — the snippet source. */
  matchedText: string
  /** Lunr's own score for this hit, exactly as the worker reported it. */
  score: number
  /**
   * Position in the worker's returned array, which upstream has already sorted
   * (`sortSearchResults` + `processTreeStatusOfSearchResults`). Callers rank
   * pages by this rather than by `score`, so results stay consistent with the
   * site's own `/search` page — see search-documentation.ts.
   */
  order: number
  /** True for a whole-page (Title) match, which by construction has no anchor/section. */
  isPageTitle: boolean
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

const isDocumentRecord = (value: unknown, requireParent: boolean): value is RawDocumentRecord => {
  if (!isRecord(value)) return false
  if (typeof value.i !== 'number' || typeof value.t !== 'string' || typeof value.u !== 'string') {
    return false
  }
  if (requireParent ? typeof value.p !== 'number' : value.p !== undefined) return false
  if (value.h !== undefined && typeof value.h !== 'string') return false
  if (value.s !== undefined && typeof value.s !== 'string') return false
  if (value.b !== undefined && !isStringArray(value.b)) return false
  return true
}

const deriveSection = (doc: RawDocumentRecord): string | null => doc.s ?? (doc.h ? doc.t : null)

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

  const { type, document, page, score, tokens } = value
  if (typeof type !== 'number' || !Number.isInteger(type)) {
    return { ok: false, message: `result ${order} has a non-integer document type` }
  }
  if (type < SEARCH_DOCUMENT_TYPE.title || type > MAX_SEARCH_DOCUMENT_TYPE) {
    return {
      ok: false,
      message: `result ${order} has document type ${type}, outside the expected ${SEARCH_DOCUMENT_TYPE.title}..${MAX_SEARCH_DOCUMENT_TYPE} range (this site never configures an AskAI index group)`
    }
  }

  const isPageTitle = type === SEARCH_DOCUMENT_TYPE.title
  if (!isDocumentRecord(document, !isPageTitle)) {
    return {
      ok: false,
      message:
        document === undefined
          ? `result ${order} (type ${type}) carries no document — the serialized lunr index matched a ref that is absent from its own documents[]`
          : `result ${order} (type ${type}) has a document missing required fields (i/t/u${
              isPageTitle ? '' : '/p'
            }) or a malformed optional field`
    }
  }

  // Upstream sets `page` to `false` for a Title result, and otherwise looks the
  // parent page's Title document up by `document.p`. A missing or mismatched
  // parent is the same class of index/document drift as an unknown ref above,
  // so it gets the same treatment.
  if (isPageTitle) {
    if (page !== false) {
      return { ok: false, message: `result ${order} is a page title but carries a parent page` }
    }
  } else if (!isDocumentRecord(page, false)) {
    return {
      ok: false,
      message: `result ${order} (type ${type}) has no resolvable parent page document for p=${document.p}`
    }
  } else if (page.i !== document.p) {
    return {
      ok: false,
      message: `result ${order} (type ${type}) resolved parent page ${page.i}, but its own document declares p=${document.p}`
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

  return {
    ok: true,
    hit: {
      url: document.u,
      anchor: document.h ? document.h.replace(/^#/, '') : null,
      section: deriveSection(document),
      matchedText: document.t,
      score,
      order,
      isPageTitle
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
 * assistant"). The specifier is byte-identical to the one SearchBar.jsx and
 * SearchPage.jsx use, so webpack resolves both to a single module instance and
 * the `Worker` that module creates on first use is shared, not duplicated.
 */
const loadSearchByWorker = (): Promise<SearchByWorkerModule> => {
  workerModule ??=
    import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js')
  return workerModule
}

/** Test-only: drops the memoized module import so the next call re-imports it. */
export const resetSearchWorkerModuleCacheForTests = (): void => {
  workerModule = undefined
}

/**
 * Runs one query through the pinned plugin's own search worker and returns
 * normalized hits **in the worker's order**. Callers are expected to request
 * more hits than they need (the plugin fans one page out into up to five
 * separate documents) and to collapse them to one result per page themselves —
 * see search-documentation.ts.
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

  let results: unknown[]
  try {
    const { searchByWorker } = await loadSearchByWorker()
    results = await searchByWorker(baseUrl, SEARCH_CONTEXT, query, limit)
  } catch (error) {
    // Not retryable *within this page session*: upstream's `SearchWorker`
    // memoizes its index fetch in a module-level Map keyed on
    // `${baseUrl}${searchContext}`, and stores the promise before awaiting it,
    // so a rejected fetch is replayed to every later caller. That cache lives
    // inside the worker and cannot be evicted from here, and reporting this as
    // retryable would only invite futile retry loops.
    return {
      ok: false,
      code: 'index_unavailable',
      message: `the documentation search worker failed to load or query the search index: ${
        error instanceof Error ? error.message : String(error)
      }. ${RELOAD_GUIDANCE}`,
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
