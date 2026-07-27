/**
 * Runs the **genuine** `SearchWorker` from the pinned
 * `@easyops-cn/docusaurus-search-local@0.55.2` over a byte-real serialized
 * index, so this directory's assumptions are pinned against upstream's actual
 * behavior rather than an imitation of it. Two things are asserted:
 *
 *  1. the worker's response contract is exactly what private-worker-adapter.ts
 *     validates and normalizes (issue #475's "pinned compatibility fixture" —
 *     an upgrade that changes result fields, `SearchDocumentType` ordinals, or
 *     the `page`/`document.p` relationship fails here with a concrete diff);
 *  2. recall for complete natural-language questions comes from upstream's own
 *     query machinery, so this repository needs no query policy of its own.
 *
 * `worker.js` is imported directly instead of through `searchByWorker.js`,
 * which would wrap it in a real `Worker` + Comlink RPC. It reads its runtime
 * config from the webpack-generated
 * `@generated/@easyops-cn/docusaurus-search-local/default/generated-constants.js`,
 * aliased for Vitest in apps/docs/vitest.config.ts exactly the way
 * `@generated/globalData` already is — see
 * apps/docs/src/test/generated-search-constants-stub.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFixtureSearchIndex,
  buildLimitSensitiveFixtureSearchIndex,
  buildNaturalLanguageFixtureSearchIndex,
  buildOrderingFixtureSearchIndex,
  LIMIT_SENSITIVE_QUERY,
  PAGE_A_URL,
  PAGE_C_URL,
  PAGE_D_URL,
  PAGE_E_URL,
  PAGE_G_URL,
  PAGE_L_URL,
  PAGE_M_URL
} from '../__fixtures__/build-fixture-index'

const BASE_URL = '/docs/'
const SEARCH_CONTEXT = ''
const LIMIT = 40

type UpstreamSearch = (
  baseUrl: string,
  searchContext: string,
  input: string,
  limit: number
) => Promise<unknown[]>

const loadUpstreamWorker = async (index: unknown): Promise<UpstreamSearch> => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(index) }))
  )
  // Imported fresh per test: the worker memoizes its fetched index in a
  // module-level Map (the same memoization that makes an index load failure
  // non-retryable in production — see private-worker-adapter.ts).
  vi.resetModules()
  const { SearchWorker } =
    await import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/worker.js')
  const worker = new SearchWorker()
  return (baseUrl, searchContext, input, limit) =>
    worker.search(baseUrl, searchContext, input, limit)
}

const urlsOf = (results: unknown[]): string[] =>
  results.map((result) => (result as { document: { u: string } }).document.u)

describe('the pinned search worker contract', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns results shaped exactly as private-worker-adapter.ts validates them', async () => {
    const search = await loadUpstreamWorker(buildFixtureSearchIndex())
    const results = await search(BASE_URL, SEARCH_CONTEXT, 'install', LIMIT)

    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      const entry = result as Record<string, unknown>
      expect(entry).toHaveProperty('document')
      expect(entry).toHaveProperty('type')
      expect(entry).toHaveProperty('page')
      expect(entry).toHaveProperty('metadata')
      expect(entry).toHaveProperty('score')
      expect(Array.isArray(entry.tokens)).toBe(true)

      const type = entry.type as number
      expect(Number.isInteger(type)).toBe(true)
      // The five configured groups; `AskAI = 5` is never emitted for this site.
      expect(type).toBeGreaterThanOrEqual(0)
      expect(type).toBeLessThanOrEqual(4)

      const document = entry.document as Record<string, unknown>
      expect(typeof document.i).toBe('number')
      expect(typeof document.t).toBe('string')
      expect(typeof document.u).toBe('string')

      if (type === 0) {
        // Upstream sets `page` to literal `false` for a Title result.
        expect(entry.page).toBe(false)
        expect(document.p).toBeUndefined()
        // `parseDocument.js`/`parsePage.js` always return a breadcrumb array,
        // so the adapter requires one rather than accepting it if present.
        expect(Array.isArray(document.b)).toBe(true)
      } else {
        expect(typeof document.p).toBe('number')
        const page = entry.page as Record<string, unknown>
        expect(page.i).toBe(document.p)
        expect(Array.isArray(page.b)).toBe(true)
        // The invariant the adapter relies on to cite a hit against the right
        // corpus ref: a child never belongs to a parent on a different page.
        expect(page.u).toBe(document.u)
      }
    }
  })

  it('reports match offsets under metadata[term].t.position, inside the indexed text', async () => {
    // The public snippet is built from these offsets — see boundedSnippet in
    // search-documentation.ts. `buildIndex.js` indexes one field (`t`) and
    // whitelists one metadata key (`position`); this pins both.
    const search = await loadUpstreamWorker(buildFixtureSearchIndex())
    const results = await search(BASE_URL, SEARCH_CONTEXT, 'install', LIMIT)

    expect(results.length).toBeGreaterThan(0)
    for (const [order, result] of results.entries()) {
      const { metadata, document, type } = result as {
        metadata: Record<string, Record<string, { position: [number, number][] }>>
        document: { t: string }
        type: number
      }
      const positions: [number, number][] = []
      for (const perTerm of Object.values(metadata)) {
        const perField = perTerm.t
        if (!perField) continue
        expect(Array.isArray(perField.position)).toBe(true)
        positions.push(...perField.position)
      }
      // Asserted **per result**, not aggregated: a single document type
      // silently ceasing to carry offsets would otherwise leave this green
      // while the public snippet quietly degrades for that type.
      expect(
        positions.length,
        `result ${order} (type ${type}) carried no t-field positions`
      ).toBeGreaterThan(0)
      for (const [start, length] of positions) {
        expect(Number.isInteger(start)).toBe(true)
        expect(Number.isInteger(length)).toBe(true)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(length).toBeGreaterThan(0)
        expect(start + length).toBeLessThanOrEqual(document.t.length)
      }
    }

    // Cover more than one document type, so the per-result assertion above is
    // actually exercising the whole shape of a real response.
    const types = new Set(results.map((result) => (result as { type: number }).type))
    expect(types.size).toBeGreaterThan(1)
  })

  it('is not monotonic in `limit` — the hazard fetchMappedPages is built around', async () => {
    const search = await loadUpstreamWorker(buildLimitSensitiveFixtureSearchIndex())
    const pagesOf = (results: unknown[]) => {
      const seen: string[] = []
      for (const url of urlsOf(results)) if (!seen.includes(url)) seen.push(url)
      return seen
    }

    // The exact tier alone fills a small limit, from the content group.
    expect(pagesOf(await search(BASE_URL, SEARCH_CONTEXT, LIMIT_SENSITIVE_QUERY, 2))).toEqual([
      PAGE_L_URL,
      PAGE_M_URL
    ])
    // A larger limit reaches a relaxed tier that matches PAGE_L's *title*, and
    // `sortSearchResults` keys a section hit on the index of its page's title —
    // so PAGE_L's already-admitted section hit is dragged down beside it and the
    // page order inverts. A bigger run is neither a prefix nor a set superset,
    // which is why search-documentation.ts starts from a fixed window and only
    // ever appends.
    expect(pagesOf(await search(BASE_URL, SEARCH_CONTEXT, LIMIT_SENSITIVE_QUERY, 8))).toEqual([
      PAGE_M_URL,
      PAGE_L_URL
    ])
  })

  it('ranks a page that matches only in the content group after weaker title-group matches', async () => {
    // Guards search-documentation.ts's ordering test: it asserts the collapsed
    // page order, which is only a meaningful regression test while this fixture
    // genuinely inverts raw score against worker order.
    const search = await loadUpstreamWorker(buildOrderingFixtureSearchIndex())
    const results = (await search(BASE_URL, SEARCH_CONTEXT, 'widget', LIMIT)) as {
      document: { u: string }
      score: number
    }[]

    const bestScoring = [...results].sort((a, b) => b.score - a.score)[0]
    expect(bestScoring.document.u).toBe(PAGE_G_URL)
    expect(results.at(-1)?.document.u).toBe(PAGE_G_URL)
  })

  it('finds every section of a page across the separate index groups', async () => {
    const search = await loadUpstreamWorker(buildFixtureSearchIndex())
    const results = await search(BASE_URL, SEARCH_CONTEXT, 'install', LIMIT)

    // Title, heading, description and content records for one page all come
    // back separately — the fan-out search-documentation.ts collapses.
    expect(urlsOf(results).filter((url) => url === PAGE_A_URL).length).toBeGreaterThan(1)
    expect(
      new Set(results.map((result) => (result as { type: number }).type)).size
    ).toBeGreaterThan(1)
  })

  it('answers a natural-language question whose words never all co-occur', async () => {
    const search = await loadUpstreamWorker(buildNaturalLanguageFixtureSearchIndex())
    // No indexed chunk contains "find"; upstream's leave-one-out relaxation
    // (smartQueries.js, at 3+ terms) is what surfaces the page anyway.
    const results = await search(
      BASE_URL,
      SEARCH_CONTEXT,
      'where can I find plugin infrastructure',
      LIMIT
    )
    expect(urlsOf(results)).toContain(PAGE_C_URL)
  })

  it('answers a natural-language hosting question without matching an unrelated page', async () => {
    const search = await loadUpstreamWorker(buildNaturalLanguageFixtureSearchIndex())
    const urls = urlsOf(
      await search(BASE_URL, SEARCH_CONTEXT, 'how can I host TinyTinkerer', LIMIT)
    )
    expect(urls).toContain(PAGE_D_URL)
    // Precision half: a page sharing no content words with the question must
    // not be cited as support for it.
    expect(urls).not.toContain(PAGE_E_URL)
  })

  it('still relaxes a query with more than the upstream 12-token cap', async () => {
    const search = await loadUpstreamWorker(buildNaturalLanguageFixtureSearchIndex())
    // 13 content tokens, one of which ("nonexistent") appears nowhere in the
    // index. `smartTerms` slices the token list to MAX_TERMS = 12 *before*
    // building terms, so relaxation still applies.
    const results = await search(
      BASE_URL,
      SEARCH_CONTEXT,
      'guide covers full hosted setup tinytinkerer vercel serves static frontend cloudflare workers nonexistent',
      LIMIT
    )
    expect(urlsOf(results)).toContain(PAGE_D_URL)
  })

  it('returns an empty array (not an error) for a query that matches nothing', async () => {
    const search = await loadUpstreamWorker(buildFixtureSearchIndex())
    const results = await search(BASE_URL, SEARCH_CONTEXT, 'xyznonexistentterm', LIMIT)
    expect(results).toEqual([])
  })
})
