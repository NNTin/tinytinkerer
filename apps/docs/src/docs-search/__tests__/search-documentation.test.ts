import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  buildFixtureSearchIndex,
  PAGE_A_URL,
  PAGE_B_URL
} from '../__fixtures__/build-fixture-index'
import { resetCorpusRefMapCacheForTests } from '../corpus-ref-map'
import { resetPrivateIndexCacheForTests } from '../private-index-adapter'
import { searchDocumentation } from '../search-documentation'

const BASE_URL = '/'
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
    resetPrivateIndexCacheForTests()
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
    resetPrivateIndexCacheForTests()
    resetCorpusRefMapCacheForTests()
    __resetGlobalData()
  })

  it('returns one deduplicated, #474-cited result per page for a multi-section match', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)

    const response = await searchDocumentation(BASE_URL, 'install')

    expect(response.ok).toBe(true)
    if (!response.ok) return
    // "Getting Started" matches via title, heading, AND content — all three
    // must collapse into a single result for that page.
    const gettingStarted = response.results.filter((result) => result.ref === 'getting-started')
    expect(gettingStarted).toHaveLength(1)
    expect(gettingStarted[0]).toMatchObject({
      ref: 'getting-started',
      title: 'Getting Started',
      permalink: PAGE_A_URL,
      anchor: 'installation'
    })
  })

  it('returns a valid empty result set (not a failure) when nothing matches', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(BASE_URL, 'xyznonexistentterm')
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

    const response = await searchDocumentation(BASE_URL, 'install')
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

    const response = await searchDocumentation(BASE_URL, 'hashing')
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results).toEqual([])
  })

  it('propagates a dev-mode failure distinctly from an empty result', async () => {
    process.env.NODE_ENV = 'test'
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(BASE_URL, 'install')
    expect(response).toMatchObject({
      ok: false,
      kind: 'documentation_search_failure',
      code: 'index_dev_unsupported'
    })
  })

  it('propagates a corpus-manifest failure', async () => {
    __resetGlobalData() // no locator published
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(BASE_URL, 'install')
    expect(response).toMatchObject({
      ok: false,
      kind: 'documentation_search_failure',
      code: 'manifest_unavailable'
    })
  })

  it('clamps maxResults and enforces the limit after page-level dedup', async () => {
    stubFetch(buildFixtureSearchIndex(), manifest)
    const response = await searchDocumentation(BASE_URL, 'install configure', 1)
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results.length).toBeLessThanOrEqual(1)
  })
})
