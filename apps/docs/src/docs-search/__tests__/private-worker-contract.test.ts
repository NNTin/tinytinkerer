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
  buildNaturalLanguageFixtureSearchIndex,
  PAGE_A_URL,
  PAGE_C_URL,
  PAGE_D_URL,
  PAGE_E_URL
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
      } else {
        expect(typeof document.p).toBe('number')
        expect((entry.page as Record<string, unknown>).i).toBe(document.p)
      }
    }
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
