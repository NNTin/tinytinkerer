/**
 * Compatibility adapter around the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
 * local-search plugin (issue #475). See ./README.md for the full rationale
 * (production-only index behavior, why `tokenize` is reused but not
 * `smartQueries`, and the package-upgrade checklist) — the notes below are
 * only what's needed to follow this file itself.
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
 * postBuildFactory.js), so no `-{dir}` suffix ever applies here either.
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
  /** Raw indexed text for the matching field — the snippet source. */
  matchedText: string
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

const isValidDocument = (value: unknown, requireParent: boolean): value is RawDocumentRecord => {
  if (!isRecord(value)) return false
  if (typeof value.i !== 'number' || typeof value.t !== 'string' || typeof value.u !== 'string') {
    return false
  }
  if (requireParent && typeof value.p !== 'number') return false
  if (value.h !== undefined && typeof value.h !== 'string') return false
  if (value.s !== undefined && typeof value.s !== 'string') return false
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
  if (!Array.isArray(payload) || payload.length < EXPECTED_GROUP_COUNT) {
    return {
      ok: false,
      message: `expected an array of ${EXPECTED_GROUP_COUNT} search index groups, got ${
        Array.isArray(payload) ? `an array of ${payload.length}` : typeof payload
      }`
    }
  }
  const groups: RawIndexGroup[] = []
  for (const [groupIndex, group] of payload.slice(0, EXPECTED_GROUP_COUNT).entries()) {
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
        })`
      }
    }
    groups.push({ documents: group.documents as RawDocumentRecord[], index: group.index })
  }
  return { ok: true, groups }
}

type LoadedIndexGroup = { documents: RawDocumentRecord[]; index: lunr.Index }
type LoadIndexesOutcome =
  | { ok: true; groups: LoadedIndexGroup[] }
  | { ok: false; code: PrivateIndexFailureCode; message: string; retryable: boolean }

let cachedIndexes: Promise<LoadIndexesOutcome> | undefined

const loadIndexes = (baseUrl: string): Promise<LoadIndexesOutcome> => {
  if (!cachedIndexes) {
    cachedIndexes = (async (): Promise<LoadIndexesOutcome> => {
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
          documents: group.documents,
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
  }
  return cachedIndexes
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing the cached promise. */
export const resetPrivateIndexCacheForTests = (): void => {
  cachedIndexes = undefined
}

/**
 * Runs one query against every lunr index group the plugin built, and
 * returns normalized, de-duplicated (by the plugin's own per-document ref)
 * hits. Callers are expected to request more hits than they need (many hits
 * usually collapse onto the same page once mapped to a #474 ref) and to
 * rank/limit/deduplicate by page themselves — see search-documentation.ts.
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

  const seenRefs = new Set<string>()
  const hits: PrivateIndexSearchHit[] = []

  for (const group of loaded.groups) {
    if (hits.length >= limit) break
    let results: lunr.Index.Result[]
    try {
      results = group.index.query((builder) => {
        for (const token of tokens) {
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
        message: `querying a loaded search index group failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        retryable: false
      }
    }

    for (const result of results) {
      if (seenRefs.has(result.ref)) continue
      const doc = group.documents.find((candidate) => candidate.i.toString() === result.ref)
      if (!doc) continue
      seenRefs.add(result.ref)
      hits.push({
        url: doc.u,
        anchor: doc.h ? doc.h.replace(/^#/, '') : null,
        matchedText: doc.t,
        score: result.score
      })
      if (hits.length >= limit) break
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return { ok: true, hits }
}
