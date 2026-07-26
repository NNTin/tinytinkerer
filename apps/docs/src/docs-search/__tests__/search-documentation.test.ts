import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  buildCrowdedPageFixtureSearchIndex,
  CROWDED_PAGE_SECTION_COUNT,
  buildFixtureSearchIndex,
  buildLongSectionFixtureSearchIndex,
  buildNaturalLanguageFixtureSearchIndex,
  buildOrderingFixtureSearchIndex,
  LONG_SECTION_MATCH_TERM,
  LONG_SECTION_TEXT,
  PAGE_A_URL,
  PAGE_B_URL,
  PAGE_C_URL,
  PAGE_D_URL,
  PAGE_E_URL,
  PAGE_F_URL,
  PAGE_G_URL,
  PAGE_H_URL,
  PAGE_I_URL,
  PAGE_J_URL,
  PAGE_K_URL
} from '../__fixtures__/build-fixture-index'
import { resetCorpusRefMapCacheForTests } from '../corpus-ref-map'
import {
  resetSearchWorkerModuleCacheForTests,
  searchPrivateWorker
} from '../private-worker-adapter'
import { searchDocumentation } from '../search-documentation'

/**
 * The private worker is driven by the **real** upstream `SearchWorker` here
 * rather than a hand-written stub, so this end-to-end composition test exercises
 * genuine query behavior, ordering and result shapes. `searchByWorker.js` itself
 * only exists to wrap that class in a `Worker` + Comlink RPC, which jsdom has
 * no use for — so it is replaced with a direct call into the same class. See
 * private-worker-contract.test.ts for the contract this relies on.
 */
vi.mock('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js', () => ({
  searchByWorker: async (
    baseUrl: string,
    searchContext: string,
    input: string,
    limit: number
  ): Promise<unknown[]> => {
    const { SearchWorker } =
      await import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/worker.js')
    return new SearchWorker().search(baseUrl, searchContext, input, limit)
  },
  fetchIndexesByWorker: () => Promise.resolve()
}))

// This site's real configuration (apps/docs/site-config.ts, docusaurus.config.ts).
const SITE_CONFIG = { baseUrl: '/docs/', trailingSlash: true }
const MANIFEST_URL = '/assets/docs-corpus/manifest.v1.abc123.json'

const manifestEntry = (ref: string, title: string, permalink: string) => ({
  ref,
  version: 'current',
  versionPath: '/docs/',
  isLast: true,
  title,
  permalink,
  unlisted: false
})

const manifestOf = (...documents: ReturnType<typeof manifestEntry>[]) => ({
  schemaVersion: 1,
  manifestHash: 'abc123',
  documents
})

const manifest = manifestOf(
  manifestEntry('getting-started', 'Getting Started', PAGE_A_URL),
  manifestEntry('search-configuration', 'Search Configuration', PAGE_B_URL)
)

const orderingManifest = manifestOf(
  manifestEntry('widget-configuration-reference', 'Widget configuration reference', PAGE_F_URL),
  manifestEntry('release-notes', 'Release notes', PAGE_G_URL),
  manifestEntry('widget-faq', 'Widget FAQ', PAGE_H_URL)
)

const naturalLanguageManifest = manifestOf(
  manifestEntry('plugin-infrastructure', 'Plugin Infrastructure', PAGE_C_URL),
  manifestEntry('vercel-deployment', 'Vercel Deployment Guide', PAGE_D_URL),
  manifestEntry('widgetkit-overview', 'WidgetKit Overview', PAGE_E_URL)
)

const longSectionManifest = manifestOf(
  manifestEntry('plugin-lifecycle', 'Plugin Lifecycle', PAGE_I_URL)
)

const crowdedManifest = manifestOf(
  manifestEntry('widget-handbook', 'Widget Handbook', PAGE_J_URL),
  manifestEntry('appendix', 'Appendix', PAGE_K_URL)
)

const stubFetch = (searchIndex: unknown, corpusManifest: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input)
      const payload = url === MANIFEST_URL ? corpusManifest : searchIndex
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) })
    })
  )
}

describe('searchDocumentation', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    // The upstream worker memoizes its fetched index in a module-level Map, so
    // each test needs a fresh module graph as well as a fresh adapter cache.
    vi.resetModules()
    resetSearchWorkerModuleCacheForTests()
    resetCorpusRefMapCacheForTests()
    __resetGlobalData()
    __setPluginData('documentation-corpus', 'default', {
      schemaVersion: 1,
      manifestHash: 'abc123',
      manifestUrl: MANIFEST_URL
    })
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    vi.unstubAllGlobals()
    vi.resetModules()
    resetSearchWorkerModuleCacheForTests()
    resetCorpusRefMapCacheForTests()
    __resetGlobalData()
  })

  it('returns one deduplicated, #474-cited result per page for a multi-section match', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)

    const response = await searchDocumentation(SITE_CONFIG, 'install')

    expect(response.ok).toBe(true)
    if (!response.ok) return
    // "Getting Started" matches via its heading, description AND content — all
    // of them must collapse into a single result for that page, represented by
    // the hit the worker itself ranked first.
    const gettingStarted = response.results.filter((result) => result.ref === 'getting-started')
    expect(gettingStarted).toHaveLength(1)
    expect(gettingStarted[0]).toEqual({
      ref: 'getting-started',
      title: 'Getting Started',
      permalink: PAGE_A_URL,
      anchor: 'installation',
      section: 'Installation',
      snippet: 'Installation'
    })
  })

  it('represents a page by its top-ranked hit, not by a weaker hit that happens to be anchored', async () => {
    // Regression for a review finding: preferring any anchored hit over an
    // unanchored one rewrote strong page-level matches into weaker, misleading
    // section citations (an exact page-title query citing "Next step", a
    // hosting question citing "1.1 Create the OAuth App").
    stubFetch(buildNaturalLanguageFixtureSearchIndex(), naturalLanguageManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'plugin infrastructure')
    expect(response.ok).toBe(true)
    if (!response.ok) return

    const [top] = response.results
    expect(top).toMatchObject({
      ref: 'plugin-infrastructure',
      title: 'Plugin Infrastructure',
      permalink: PAGE_C_URL,
      // The page's own title matched; nothing about that match supports citing
      // one of its later sections instead.
      anchor: null,
      section: null
    })
    expect(top.snippet).toBe('Plugin Infrastructure')
  })

  it('answers the locked natural-language queries with complete, citable results', async () => {
    stubFetch(buildNaturalLanguageFixtureSearchIndex(), naturalLanguageManifest)

    const hosting = await searchDocumentation(SITE_CONFIG, 'how can I host TinyTinkerer')
    expect(hosting.ok).toBe(true)
    if (!hosting.ok) return
    expect(hosting.results[0]).toMatchObject({
      ref: 'vercel-deployment',
      title: 'Vercel Deployment Guide',
      permalink: PAGE_D_URL
    })
    expect(hosting.results[0].snippet.length).toBeGreaterThan(0)
    // Precision: a page sharing no content words with the question must not be
    // handed to the model as support for it.
    expect(hosting.results.some((result) => result.permalink === PAGE_E_URL)).toBe(false)

    const plugins = await searchDocumentation(SITE_CONFIG, 'where can I find plugin infrastructure')
    expect(plugins.ok).toBe(true)
    if (!plugins.ok) return
    expect(plugins.results[0]).toMatchObject({
      ref: 'plugin-infrastructure',
      permalink: PAGE_C_URL
    })
  })

  it('builds a snippet around the match, not from the start of a long section', async () => {
    // Regression for a review finding: a match thousands of characters into an
    // indexed section produced a leading snippet containing none of the query
    // terms — a citation with no evidence for why it matched.
    stubFetch(buildLongSectionFixtureSearchIndex(), longSectionManifest)

    const response = await searchDocumentation(SITE_CONFIG, LONG_SECTION_MATCH_TERM)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results).toHaveLength(1)

    const { snippet } = response.results[0]
    expect(snippet).toContain(LONG_SECTION_MATCH_TERM)
    expect(snippet.length).toBeLessThanOrEqual(302) // budget plus both ellipses
    // Elided on both sides: the match sits well inside the section.
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)

    // The match must sit *inside* the window with context either side, not be
    // jammed against an edge — a snippet that ends at the matched word gives an
    // assistant the term but not what the page says about it.
    const at = snippet.indexOf(LONG_SECTION_MATCH_TERM)
    expect(at).toBeGreaterThan(20)
    expect(snippet.length - (at + LONG_SECTION_MATCH_TERM.length)).toBeGreaterThan(20)
    // And the window must not start mid-word.
    expect(snippet.slice(1)).toMatch(/^[A-Za-z]/)
    expect(LONG_SECTION_TEXT).toContain(snippet.slice(1, 40))
  })

  it('keeps over-fetching until enough distinct pages survive deduplication', async () => {
    // Regression for a review finding: the plugin emits one document per
    // *section*, so a single large page can occupy every slot of a fixed
    // `maxResults * N` raw window and hide every page behind it.
    stubFetch(buildCrowdedPageFixtureSearchIndex(), crowdedManifest)

    // A single fixed-size pass genuinely cannot see the second page...
    const oneShot = await searchPrivateWorker(SITE_CONFIG.baseUrl, 'widget', 40)
    expect(oneShot.ok).toBe(true)
    if (!oneShot.ok) return
    expect(oneShot.hits).toHaveLength(40)
    expect(oneShot.hits.every((hit) => hit.url === PAGE_J_URL)).toBe(true)
    // ...because the page contributes more sections than that pass can show.
    expect(CROWDED_PAGE_SECTION_COUNT).toBeGreaterThan(oneShot.hits.length)

    // ...but the composed API still returns both.
    const response = await searchDocumentation(SITE_CONFIG, 'widget', 2)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results.map((result) => result.ref)).toEqual(['widget-handbook', 'appendix'])
  })

  it('keeps the worker ordering instead of re-ranking pages by raw lunr score', async () => {
    stubFetch(buildOrderingFixtureSearchIndex(), orderingManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'widget')
    expect(response.ok).toBe(true)
    if (!response.ok) return

    // Scores from five independent lunr indexes aren't comparable, so page
    // order must be the worker's own (sortSearchResults), which scans the title
    // group before the content group. `release-notes` has by far the highest
    // raw score but matches only in content, so it must still come last — a
    // score-descending re-sort would promote it to first. That the fixture
    // really does invert score against order is asserted in
    // private-worker-contract.test.ts, against the real worker.
    expect(response.results.map((result) => result.ref)).toEqual([
      'widget-faq',
      'widget-configuration-reference',
      'release-notes'
    ])
  })

  it('returns a valid empty result set (not a failure) when nothing matches', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(SITE_CONFIG, 'xyznonexistentterm')
    expect(response).toEqual({ ok: true, query: 'xyznonexistentterm', results: [] })
  })

  it('drops results for pages the #474 corpus marks unlisted', async () => {
    const unlistedManifest = {
      ...manifest,
      documents: manifest.documents.map((doc) =>
        doc.ref === 'getting-started' ? { ...doc, unlisted: true } : doc
      )
    }
    stubFetch(buildFixtureSearchIndex(), unlistedManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'install')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results.some((result) => result.ref === 'getting-started')).toBe(false)
  })

  it('drops hits that do not map to any #474 corpus document', async () => {
    const partialManifest = {
      ...manifest,
      documents: manifest.documents.filter((doc) => doc.ref !== 'search-configuration')
    }
    stubFetch(buildFixtureSearchIndex(), partialManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'hashing')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results).toEqual([])
  })

  it('propagates a dev-mode failure distinctly from an empty result', async () => {
    process.env.NODE_ENV = 'test'
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(SITE_CONFIG, 'install')
    expect(response).toMatchObject({
      ok: false,
      kind: 'documentation_search_failure',
      code: 'index_dev_unsupported'
    })
  })

  it('propagates a corpus-manifest failure', async () => {
    __resetGlobalData() // no locator published
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(SITE_CONFIG, 'install')
    expect(response).toMatchObject({
      ok: false,
      kind: 'documentation_search_failure',
      code: 'manifest_unavailable'
    })
  })

  it('gives a page matched only by its title a null section and anchor', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(SITE_CONFIG, 'started')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const gettingStarted = response.results.find((result) => result.ref === 'getting-started')
    expect(gettingStarted?.section).toBeNull()
    expect(gettingStarted?.anchor).toBeNull()
  })

  it('clamps maxResults and enforces the limit after page-level dedup', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(SITE_CONFIG, 'install configure', 1)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results.length).toBeLessThanOrEqual(1)
  })
})
