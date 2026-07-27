import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  buildCrowdedPageFixtureSearchIndex,
  CROWDED_PAGE_SECTION_COUNT,
  buildFixtureSearchIndex,
  buildHashlessHeadingFixtureSearchIndex,
  buildLimitSensitiveFixtureSearchIndex,
  buildLongSectionFixtureSearchIndex,
  buildNaturalLanguageFixtureSearchIndex,
  buildOrderingFixtureSearchIndex,
  buildSnippetBoundaryFixtureSearchIndex,
  LIMIT_SENSITIVE_QUERY,
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
  PAGE_K_URL,
  PAGE_L_URL,
  PAGE_M_URL,
  PAGE_N_URL,
  PAGE_O_URL,
  SNIPPET_BOUNDARY_TERM,
  SNIPPET_BOUNDARY_TRAILER
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
  source: `@site/../../docs/${ref}.md`,
  contentHash: 'c'.repeat(64),
  artifactHash: 'a'.repeat(64),
  unlisted: false,
  artifact: `/docs/assets/docs-corpus/documents/${ref}.json`,
  characterCount: 1000,
  sectionCount: 3
})

/**
 * Manifests carry a real content hash, because the shared corpus store now
 * verifies it (docs-corpus/manifest-store.ts) rather than trusting the string.
 * Computed exactly the way build-corpus.ts computes it.
 */
const manifestOf = (...documents: ReturnType<typeof manifestEntry>[]) => ({
  schemaVersion: 1,
  manifestHash: createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, documents }))
    .digest('hex'),
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

const limitSensitiveManifest = manifestOf(
  manifestEntry('alpha-beta-overview', 'Alpha beta overview', PAGE_L_URL),
  manifestEntry('zeta-notes', 'Zeta notes', PAGE_M_URL)
)

const hashlessHeadingManifest = manifestOf(
  manifestEntry('contributing/CONTRIBUTING', 'Contributing', PAGE_N_URL)
)

const snippetBoundaryManifest = manifestOf(
  manifestEntry('snippet-boundary', 'Snippet boundary', PAGE_O_URL)
)

/**
 * Publishes the locator for the manifest being served, so the two agree — the
 * shared corpus store cross-checks them and then verifies the manifest's own
 * content hash. `publishLocator: false` covers "the corpus plugin was never
 * registered".
 */
const stubFetch = (
  searchIndex: unknown,
  corpusManifest: unknown,
  { publishLocator = true }: { publishLocator?: boolean } = {}
) => {
  if (publishLocator) {
    __setPluginData('documentation-corpus', 'default', {
      schemaVersion: 1,
      manifestHash: (corpusManifest as { manifestHash: string }).manifestHash,
      manifestUrl: MANIFEST_URL
    })
  }
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

  // 300 is MAX_SNIPPET_CHARS in search-documentation.ts; the interesting cases
  // are the ones straddling it, which the "thousands of characters in" test
  // could never reach.
  it.each([
    ['ends well before the budget', 40],
    ['ends just before the budget', 290],
    ['ends exactly at the budget', 294],
    ['ends just past the budget', 298],
    ['starts well past the budget', 900]
  ])('centers the snippet on a match that %s', async (_label, matchStart) => {
    stubFetch(buildSnippetBoundaryFixtureSearchIndex(matchStart), snippetBoundaryManifest)

    const response = await searchDocumentation(SITE_CONFIG, SNIPPET_BOUNDARY_TERM)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const { snippet } = response.results[0]

    expect(snippet).toContain(SNIPPET_BOUNDARY_TERM)
    // The point of centering: enough of what follows the match survives to
    // explain why the page matched.
    const after = snippet.slice(
      snippet.indexOf(SNIPPET_BOUNDARY_TERM) + SNIPPET_BOUNDARY_TERM.length
    )
    expect(after.replace(/…$/, '').trim().length).toBeGreaterThan(60)
    expect(SNIPPET_BOUNDARY_TRAILER).toContain(after.replace(/…$/, '').trim().slice(0, 30))
  })

  it('keeps a snippet readable when the match sits at the very end of the text', async () => {
    // Nothing follows the match here, so the window has to lean the other way
    // rather than insist on trailing context that does not exist.
    stubFetch(
      buildSnippetBoundaryFixtureSearchIndex(900, { trailer: false }),
      snippetBoundaryManifest
    )

    const response = await searchDocumentation(SITE_CONFIG, SNIPPET_BOUNDARY_TERM)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results[0].snippet).toContain(SNIPPET_BOUNDARY_TERM)
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

  it('returns the same ordering regardless of how many results were requested', async () => {
    // Regression for a review finding: the raw worker limit used to be derived
    // from `maxResults`, and the pinned worker is *not* monotonic in that limit
    // — so asking for more results reordered the top citations. On the real
    // index, `app` at 6 vs 20 disagreed about positions 5 and 6.
    stubFetch(buildLimitSensitiveFixtureSearchIndex(), limitSensitiveManifest)

    // First: the hazard is real, at the worker level, with this fixture.
    const small = await searchPrivateWorker(SITE_CONFIG.baseUrl, LIMIT_SENSITIVE_QUERY, 2)
    const large = await searchPrivateWorker(SITE_CONFIG.baseUrl, LIMIT_SENSITIVE_QUERY, 8)
    expect(small.ok && large.ok).toBe(true)
    if (!small.ok || !large.ok) return
    const firstPages = (hits: typeof small.hits) => {
      const seen: string[] = []
      for (const hit of hits) if (!seen.includes(hit.url)) seen.push(hit.url)
      return seen
    }
    expect(firstPages(small.hits)).toEqual([PAGE_L_URL, PAGE_M_URL])
    // A larger limit admits PAGE_L's title from a relaxed tier, which drags
    // PAGE_L's already-admitted section hit down beside it — the page order
    // inverts, so a bigger run is neither a prefix nor a set superset.
    expect(firstPages(large.hits)).toEqual([PAGE_M_URL, PAGE_L_URL])

    // Second: the public API is nonetheless prefix-stable across `maxResults`.
    const responses = await Promise.all(
      [1, 2, 5, 20].map(async (n) => {
        resetSearchWorkerModuleCacheForTests()
        return searchDocumentation(SITE_CONFIG, LIMIT_SENSITIVE_QUERY, n)
      })
    )
    const refLists = responses.map((response) => (response.ok ? response.results : null))
    expect(refLists.every((list) => list !== null)).toBe(true)
    const widest = refLists.at(-1)?.map((result) => result.ref) ?? []
    for (const list of refLists) {
      expect(list?.map((result) => result.ref)).toEqual(widest.slice(0, list?.length))
    }
    // And the representative hit for a shared page is identical, not just its ref.
    expect(refLists[0]?.[0]).toEqual(refLists.at(-1)?.[0])
  })

  it('stays prefix-stable across maxResults when the over-fetch loop expands', async () => {
    stubFetch(buildCrowdedPageFixtureSearchIndex(), crowdedManifest)

    const widest = await searchDocumentation(SITE_CONFIG, 'widget', 20)
    expect(widest.ok).toBe(true)
    if (!widest.ok) return

    for (const n of [1, 2]) {
      resetSearchWorkerModuleCacheForTests()
      const narrower = await searchDocumentation(SITE_CONFIG, 'widget', n)
      expect(narrower.ok).toBe(true)
      if (!narrower.ok) return
      expect(narrower.results).toEqual(widest.results.slice(0, narrower.results.length))
    }
  })

  it('names a section for a heading that renders no anchor', async () => {
    // Regression for a review finding, and not hypothetical: the production
    // index carries `h: ""` for four headings under /docs/contributing/.
    // `anchor: null` is right (nothing to navigate to); `section: null` was not.
    stubFetch(buildHashlessHeadingFixtureSearchIndex(), hashlessHeadingManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'security issues')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results[0]).toEqual({
      ref: 'contributing/CONTRIBUTING',
      title: 'Contributing',
      permalink: PAGE_N_URL,
      anchor: null,
      section: 'Security Issues',
      snippet: 'Security Issues'
    })
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
    // Rebuilt through manifestOf, not spread over `manifest`: the store now
    // verifies the manifest's own content hash, so an edited payload keeping the
    // original hash is (correctly) rejected as tampered.
    const unlistedManifest = manifestOf(
      { ...manifestEntry('getting-started', 'Getting Started', PAGE_A_URL), unlisted: true },
      manifestEntry('search-configuration', 'Search Configuration', PAGE_B_URL)
    )
    stubFetch(buildFixtureSearchIndex(), unlistedManifest)

    const response = await searchDocumentation(SITE_CONFIG, 'install')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results.some((result) => result.ref === 'getting-started')).toBe(false)
  })

  it('drops hits that do not map to any #474 corpus document', async () => {
    const partialManifest = manifestOf(
      manifestEntry('getting-started', 'Getting Started', PAGE_A_URL)
    )
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
    stubFetch(buildFixtureSearchIndex(), manifest, { publishLocator: false })
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
