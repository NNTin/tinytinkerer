import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  buildFixtureSearchIndex,
  buildOrderingFixtureSearchIndex,
  PAGE_A_URL,
  PAGE_B_URL,
  PAGE_F_URL,
  PAGE_G_URL,
  PAGE_H_URL
} from '../__fixtures__/build-fixture-index'
import { resetCorpusRefMapCacheForTests } from '../corpus-ref-map'
import { resetSearchWorkerModuleCacheForTests } from '../private-worker-adapter'
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

const manifest = {
  schemaVersion: 1,
  manifestHash: 'abc123',
  documents: [
    {
      ref: 'getting-started',
      version: 'current',
      versionPath: '/docs/',
      isLast: true,
      title: 'Getting Started',
      permalink: PAGE_A_URL,
      unlisted: false
    },
    {
      ref: 'search-configuration',
      version: 'current',
      versionPath: '/docs/',
      isLast: true,
      title: 'Search Configuration',
      permalink: PAGE_B_URL,
      unlisted: false
    }
  ]
}

const manifestEntry = (ref: string, title: string, permalink: string) => ({
  ref,
  version: 'current',
  versionPath: '/docs/',
  isLast: true,
  title,
  permalink,
  unlisted: false
})

const orderingManifest = {
  schemaVersion: 1,
  manifestHash: 'abc123',
  documents: [
    manifestEntry('widget-configuration-reference', 'Widget configuration reference', PAGE_F_URL),
    manifestEntry('release-notes', 'Release notes', PAGE_G_URL),
    manifestEntry('widget-faq', 'Widget FAQ', PAGE_H_URL)
  ]
}

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
    // "Getting Started" matches via title, heading, description AND content —
    // all of them must collapse into a single result for that page.
    const gettingStarted = response.results.filter((result) => result.ref === 'getting-started')
    expect(gettingStarted).toHaveLength(1)
    // An anchored section match beats the page-title match, so the citation
    // points at the matching section rather than the top of the page.
    expect(gettingStarted[0]).toMatchObject({
      ref: 'getting-started',
      title: 'Getting Started',
      permalink: PAGE_A_URL,
      anchor: 'installation',
      section: 'Installation'
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
    // score-descending re-sort would promote it to first.
    expect(response.results.map((result) => result.ref)).toEqual([
      'widget-faq',
      'widget-configuration-reference',
      'release-notes'
    ])

    // Guards the guard: assert the fixture really does invert score against
    // order, so the expectation above can't pass for the wrong reason.
    const { searchPrivateWorker } = await import('../private-worker-adapter')
    const raw = await searchPrivateWorker(SITE_CONFIG.baseUrl, 'widget', 40)
    expect(raw.ok).toBe(true)
    if (!raw.ok) return
    const bestScoring = [...raw.hits].sort((a, b) => b.score - a.score)[0]
    expect(bestScoring.url).toBe(PAGE_G_URL)
    expect(bestScoring.order).toBe(raw.hits.length - 1)
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
