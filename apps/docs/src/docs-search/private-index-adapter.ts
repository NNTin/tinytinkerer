/**
 * Compatibility adapter around the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
 * local-search plugin (issue #475). See ./README.md for the full rationale
 * (production-only index behavior, the tiered query-relaxation strategy, why
 * `tokenize` is reused but not `smartQueries`/`searchByWorker`, and the
 * package-upgrade checklist) — the notes below are only what's needed to
 * follow this file itself.
 *
 * This is the ONLY module allowed to know that plugin's private, unversioned
 * wire format. Every export here returns a small, TinyTinkerer-owned shape
 * (`PrivateIndexSearchHit`) instead of the plugin's abbreviated document
 * fields (`i`/`t`/`u`/`p`/`h`/`s`/`b` — see buildIndex.js/scanDocuments.js in
 * the pinned version). Nothing outside `apps/docs/src/docs-search` may import
 * from `@easyops-cn/docusaurus-search-local` — see search-documentation.ts
 * for the public entry point.
 *
 * The fetch URL below is a hard-coded `search-index.json` literal, not read
 * from the plugin: `searchLocalOptions` in docusaurus.config.ts pins
 * `hashed: true` (not `"filename"`), so per generate.js the on-disk filename
 * never changes — the content hash only ever appears as a `?_=`
 * cache-busting query string. `docsRouteBasePath: '/'` and no
 * `searchContextByPaths` mean there is exactly one root index (`k === ''` in
 * postBuildFactory.js), so no `-{dir}` suffix ever applies here either. The
 * `?_=` cache-buster itself can't be reproduced here: it's read from a
 * webpack-generated virtual module (`@generated/@easyops-cn/...`), the same
 * kind of build-only channel `searchByWorker`/`smartQueries` depend on (see
 * README). Omitting it only affects browser HTTP cache aggressiveness right
 * after a fresh deploy, not correctness.
 */
import lunr from 'lunr'
// The one sanctioned deep import into the pinned plugin's private surface;
// see the module doc above.
import { tokenize } from '@easyops-cn/docusaurus-search-local/dist/client/client/utils/tokenize.js'

// The plugin writes exactly 5 index groups in this positional order unless
// `askAi` is configured (it isn't here) — see buildIndex.js/scanDocuments.js.
const EXPECTED_GROUP_COUNT = 5
const SEARCH_INDEX_FILENAME = 'search-index.json'

// Must mirror docusaurus.config.ts's `searchLocalOptions.language`. Kept as a
// literal (see module doc) rather than read from the plugin's generated
// constants module.
const INDEX_LANGUAGE = ['en']

// Tokens longer than this get a small amount of fuzzy (edit-distance)
// tolerance; short tokens stay exact since a 1-edit typo on a 3-letter word
// matches almost anything.
//
// Deliberately no wildcard here (unlike the plugin's own `smartQueries`,
// which adds a *trailing* wildcard only to a token it suspects is still
// being typed). lunr applies its query pipeline (the stemmer) to the raw
// term text *before* wildcard characters are appended, so `install*` is
// stemmed as the literal string "install*" and no longer matches the
// indexed (stemmed) token "instal" the way a plain `install` query does.
// Wildcards only help for genuinely incomplete prefixes, which a complete
// assistant query is not.
const FUZZY_MIN_TOKEN_LENGTH = 4
const FUZZY_EDIT_DISTANCE = 1

/**
 * Progressive query relaxation, mirroring the *mechanism* (not the
 * incremental-typing wildcards) the plugin's own `smartQueries.js` uses to
 * answer questions its "all tokens required" baseline can't: lunr's default
 * English `stopWordFilter` is active for this site (searchLocalOptions never
 * sets `removeDefaultStopWordFilter`), so a stopword submitted as a
 * `REQUIRED` query term is already a no-op — `exact` and `stopword_trimmed`
 * only diverge if that ever changes. `leave_one_out` is what actually adds
 * recall: it drops exactly one remaining content word at a time and re-runs
 * an all-`REQUIRED` query, so a page whose matching words are split across
 * the literal query but never all co-occur in one indexed field can still be
 * found. See README.md for the full trace (including why the threshold below
 * is deliberately lower than the upstream plugin's own `> 2`).
 */
const TIER_RANK = { exact: 0, stopword_trimmed: 1, leave_one_out: 2 } as const
type Tier = keyof typeof TIER_RANK

// Large, fixed separations so tier always dominates raw lunr score in the
// merge/sort below, without changing `score`'s type. Lunr's tf-idf-derived
// scores stay in a small range for realistic corpora/term counts, so these
// offsets are effectively infinite separation between tiers.
const TIER_SCORE_OFFSET: Record<Tier, number> = {
  exact: 2_000_000,
  stopword_trimmed: 1_000_000,
  leave_one_out: 0
}

// Deliberately lower than the upstream plugin's own `> 2` (3+ content words)
// threshold: a 2-content-word query (e.g. "how can I host TinyTinkerer")
// falls back to matching either word alone as a last-resort tier, always
// ranked below any exact/stopword-trimmed match. This is a documented
// precision/recall trade-off favoring #471's natural-language goal over
// upstream's more conservative default — see README.md.
const LEAVE_ONE_OUT_MIN_TOKENS = 2
// Safety cap against pathologically long queries generating O(n) variants;
// mirrors the scale of upstream's own term-count budget.
const MAX_LEAVE_ONE_OUT_TOKENS = 12

type RawDocumentRecord = {
  i: number
  t: string
  u: string
  p?: number
  h?: string
  s?: string
  b?: string[]
}

type RawIndexGroup = {
  documents: RawDocumentRecord[]
  index: object
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
  /**
   * Relative ranking key: a large per-tier offset (see `TIER_SCORE_OFFSET`)
   * plus lunr's own tf-idf score. Meaningful only for this adapter's own
   * sort, not as an absolute relevance measure comparable across calls.
   */
  score: number
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

const isValidDocument = (value: unknown, requireParent: boolean): value is RawDocumentRecord => {
  if (!isRecord(value)) return false
  if (typeof value.i !== 'number' || typeof value.t !== 'string' || typeof value.u !== 'string') {
    return false
  }
  if (requireParent && typeof value.p !== 'number') return false
  if (value.h !== undefined && typeof value.h !== 'string') return false
  if (value.s !== undefined && typeof value.s !== 'string') return false
  if (value.b !== undefined && !isStringArray(value.b)) return false
  return true
}

/**
 * Structural validation of the fetched `search-index.json` payload. The
 * upstream worker (`legacyFetchIndexes` in worker.js) casts this payload with
 * no runtime check at all; we do not inherit that assumption, since a future
 * plugin upgrade changing this shape is exactly the failure mode issue #475
 * asks us to surface loudly instead of silently mis-mapping results.
 */
const validateRawSearchIndex = (
  payload: unknown
): { ok: true; groups: RawIndexGroup[] } | { ok: false; message: string } => {
  if (!Array.isArray(payload) || payload.length !== EXPECTED_GROUP_COUNT) {
    return {
      ok: false,
      message: `expected an array of exactly ${EXPECTED_GROUP_COUNT} search index groups, got ${
        Array.isArray(payload) ? `an array of ${payload.length}` : typeof payload
      }`
    }
  }
  const groups: RawIndexGroup[] = []
  for (const [groupIndex, group] of payload.entries()) {
    if (!isRecord(group) || !Array.isArray(group.documents) || !isRecord(group.index)) {
      return {
        ok: false,
        message: `index group ${groupIndex} is missing a documents[] array or index{} object`
      }
    }
    const requireParent = groupIndex !== 0 // group 0 is the title index; only it lacks `p`.
    const invalidAt = group.documents.findIndex((doc) => !isValidDocument(doc, requireParent))
    if (invalidAt !== -1) {
      return {
        ok: false,
        message: `index group ${groupIndex} document ${invalidAt} is missing required fields (i/t/u${
          requireParent ? '/p' : ''
        }) or has a malformed optional field`
      }
    }
    const documents = group.documents as RawDocumentRecord[]
    const seenIds = new Set<number>()
    for (const doc of documents) {
      if (seenIds.has(doc.i)) {
        return {
          ok: false,
          message: `index group ${groupIndex} has a duplicate document id ${doc.i}`
        }
      }
      seenIds.add(doc.i)
    }
    groups.push({ documents, index: group.index })
  }
  return { ok: true, groups }
}

type LoadedIndexGroup = { documents: Map<string, RawDocumentRecord>; index: lunr.Index }
type LoadIndexesOutcome =
  | { ok: true; groups: LoadedIndexGroup[] }
  | { ok: false; code: PrivateIndexFailureCode; message: string; retryable: boolean }

let cachedIndexes: Promise<LoadIndexesOutcome> | undefined

const loadIndexes = (baseUrl: string): Promise<LoadIndexesOutcome> => {
  if (!cachedIndexes) {
    const promise = (async (): Promise<LoadIndexesOutcome> => {
      if (process.env.NODE_ENV !== 'production') {
        return {
          ok: false,
          code: 'index_dev_unsupported',
          message:
            'The local search index is generated only by `docusaurus build` (see postBuildFactory.js); it does not exist in a development server.',
          retryable: false
        }
      }

      const url = `${baseUrl}${SEARCH_INDEX_FILENAME}`
      let response: Response
      try {
        // Same-origin static build asset (search-index.json), not a backend
        // API call; none of fetchWithTelemetry's RequestTelemetryMetadata.origin
        // values apply.
        // eslint-disable-next-line no-restricted-globals -- see comment above
        response = await fetch(url)
      } catch (error) {
        return {
          ok: false,
          code: 'index_unavailable',
          message: `failed to fetch the search index at "${url}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          retryable: true
        }
      }
      if (!response.ok) {
        return {
          ok: false,
          code: 'index_unavailable',
          message: `search index request to "${url}" failed with HTTP ${response.status}`,
          retryable: true
        }
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return {
          ok: false,
          code: 'index_incompatible',
          message: `search index response from "${url}" was not valid JSON`,
          retryable: false
        }
      }

      const validated = validateRawSearchIndex(payload)
      if (!validated.ok) {
        return {
          ok: false,
          code: 'index_incompatible',
          message: `search index payload failed compatibility validation: ${validated.message}. This usually means @easyops-cn/docusaurus-search-local was upgraded — see the upgrade checklist at the top of private-index-adapter.ts.`,
          retryable: false
        }
      }

      try {
        const groups = validated.groups.map((group) => ({
          documents: new Map(group.documents.map((doc) => [doc.i.toString(), doc])),
          index: lunr.Index.load(group.index)
        }))
        return { ok: true, groups }
      } catch (error) {
        return {
          ok: false,
          code: 'index_incompatible',
          message: `search index groups failed to load as lunr indexes: ${
            error instanceof Error ? error.message : String(error)
          }`,
          retryable: false
        }
      }
    })()
    cachedIndexes = promise
    // Retryable failures (network/HTTP) must not stick around forever — a
    // later call should get a fresh attempt instead of replaying the same
    // failure until a full page reload. Non-retryable outcomes (success or a
    // genuine incompatibility) are stable and stay cached.
    void promise.then((outcome) => {
      if (!outcome.ok && outcome.retryable && cachedIndexes === promise) {
        cachedIndexes = undefined
      }
    })
  }
  return cachedIndexes
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing the cached promise. */
export const resetPrivateIndexCacheForTests = (): void => {
  cachedIndexes = undefined
}

// `lunr.stopWordFilter` only reads `token.toString()`, but its type
// declarations require a real `lunr.Token`, not a plain string — construct
// one rather than casting past the stricter (but functionally equivalent)
// public type.
const isStopword = (token: string): boolean =>
  lunr.stopWordFilter(new lunr.Token(token, {})) === undefined

const deriveSection = (doc: RawDocumentRecord): string | null => doc.s ?? (doc.h ? doc.t : null)

type QueryTier = { tier: Tier; tokens: string[] }

/**
 * Builds the ordered list of query variants to try. Tier A (`exact`) is
 * always tried first and alone reproduces this adapter's original,
 * unmodified behavior. Later tiers are only ever consulted by the caller if
 * an earlier tier didn't find enough distinct results — see
 * `searchPrivateIndex`.
 */
const buildQueryTiers = (tokens: string[]): QueryTier[] => {
  const tiers: QueryTier[] = [{ tier: 'exact', tokens }]

  const nonStopTokens = tokens.filter((token) => !isStopword(token))
  const trimmed =
    nonStopTokens.length > 0 && nonStopTokens.length < tokens.length ? nonStopTokens : null
  if (trimmed) {
    tiers.push({ tier: 'stopword_trimmed', tokens: trimmed })
  }

  const leaveOneOutBase = trimmed ?? tokens
  if (
    leaveOneOutBase.length >= LEAVE_ONE_OUT_MIN_TOKENS &&
    leaveOneOutBase.length <= MAX_LEAVE_ONE_OUT_TOKENS
  ) {
    for (let index = 0; index < leaveOneOutBase.length; index += 1) {
      tiers.push({
        tier: 'leave_one_out',
        tokens: [...leaveOneOutBase.slice(0, index), ...leaveOneOutBase.slice(index + 1)]
      })
    }
  }
  return tiers
}

/**
 * Runs one or more progressively-relaxed queries (see `buildQueryTiers`)
 * against every lunr index group the plugin built, and returns normalized,
 * de-duplicated (by the plugin's own per-document ref, across every tier and
 * group) hits. Callers are expected to request more hits than they need
 * (many hits usually collapse onto the same page once mapped to a #474 ref)
 * and to rank/limit/deduplicate by page themselves — see
 * search-documentation.ts.
 */
export const searchPrivateIndex = async (
  baseUrl: string,
  query: string,
  limit: number
): Promise<PrivateIndexOutcome> => {
  const loaded = await loadIndexes(baseUrl)
  if (!loaded.ok) return loaded

  const tokens = tokenize(query, INDEX_LANGUAGE)
  if (tokens.length === 0) {
    // A query with no indexable tokens (empty/whitespace/punctuation-only) is
    // a valid zero-result search, not a failure.
    return { ok: true, hits: [] }
  }

  const bestByRef = new Map<string, { tier: Tier; hit: PrivateIndexSearchHit }>()

  for (const { tier, tokens: tierTokens } of buildQueryTiers(tokens)) {
    // Every group is scanned fully for this tier before deciding whether to
    // escalate — breaking early would bias both the escalation check and the
    // final ranking toward whichever group happens to be queried first, and
    // could miss a later group's better section for an already-seen page.
    for (const group of loaded.groups) {
      let results: lunr.Index.Result[]
      try {
        results = group.index.query((builder) => {
          for (const token of tierTokens) {
            builder.term(token, {
              presence: lunr.Query.presence.REQUIRED,
              ...(token.length > FUZZY_MIN_TOKEN_LENGTH
                ? { editDistance: FUZZY_EDIT_DISTANCE }
                : null)
            })
          }
        })
      } catch (error) {
        return {
          ok: false,
          code: 'index_incompatible',
          message: `querying a loaded search index group (tier=${tier}) failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          retryable: false
        }
      }

      for (const result of results) {
        const doc = group.documents.get(result.ref)
        if (!doc) continue

        const candidateHit: PrivateIndexSearchHit = {
          url: doc.u,
          anchor: doc.h ? doc.h.replace(/^#/, '') : null,
          section: deriveSection(doc),
          matchedText: doc.t,
          score: result.score + TIER_SCORE_OFFSET[tier]
        }

        const existing = bestByRef.get(result.ref)
        const isBetter =
          !existing ||
          TIER_RANK[tier] < TIER_RANK[existing.tier] ||
          (tier === existing.tier && candidateHit.score > existing.hit.score)
        if (isBetter) bestByRef.set(result.ref, { tier, hit: candidateHit })
      }
    }

    if (bestByRef.size >= limit) break
  }

  const hits = [...bestByRef.values()]
    .map(({ hit }) => hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return { ok: true, hits }
}
