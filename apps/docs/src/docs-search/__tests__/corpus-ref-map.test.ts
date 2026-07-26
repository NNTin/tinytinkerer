import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import { loadCorpusRefMap, resetCorpusRefMapCacheForTests } from '../corpus-ref-map'

const MANIFEST_URL = '/assets/docs-corpus/manifest.v1.abc123.json'
// This site's real configuration: `resolveDocsBaseUrl` in apps/docs/site-config.ts
// returns `/docs/`, and docusaurus.config.ts sets `trailingSlash: true`.
const SITE_CONFIG = { baseUrl: '/docs/', trailingSlash: true }

const setLocator = (manifestUrl = MANIFEST_URL) => {
  __setPluginData('documentation-corpus', 'default', {
    schemaVersion: 1,
    manifestHash: 'abc123',
    manifestUrl
  })
}

const stubFetchJson = (payload: unknown, init?: { ok?: boolean; status?: number }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        json: () => Promise.resolve(payload)
      })
    )
  )
}

const validManifest = {
  schemaVersion: 1,
  manifestHash: 'abc123',
  documents: [
    {
      ref: 'getting-started',
      version: 'current',
      versionPath: '/docs/',
      isLast: true,
      title: 'Getting Started',
      permalink: '/docs/getting-started/',
      unlisted: false
    },
    {
      ref: 'index',
      version: 'current',
      versionPath: '/docs/',
      isLast: true,
      title: 'TinyTinkerer documentation',
      permalink: '/docs/',
      unlisted: false
    },
    {
      ref: 'secret',
      version: 'current',
      versionPath: '/docs/',
      isLast: true,
      title: 'Secret Page',
      permalink: '/docs/secret/',
      unlisted: true
    }
  ]
}

describe('loadCorpusRefMap', () => {
  beforeEach(() => {
    resetCorpusRefMapCacheForTests()
    __resetGlobalData()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetCorpusRefMapCacheForTests()
    __resetGlobalData()
  })

  it('reports manifest_unavailable when the corpus plugin has not published a locator', async () => {
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: false })
  })

  it('reports manifest_unavailable (retryable) on a non-OK manifest fetch', async () => {
    setLocator()
    stubFetchJson({}, { ok: false, status: 500 })
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: true })
  })

  it('reports manifest_incompatible when the payload does not match the #474 schema', async () => {
    setLocator()
    stubFetchJson({ schemaVersion: 1, documents: [{ ref: 'x' }] })
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('resolves a matching entry by permalink, tolerating trailing-slash differences', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/getting-started/')?.ref).toBe('getting-started')
    expect(outcome.resolve('/docs/getting-started')?.ref).toBe('getting-started')
  })

  it('resolves the site root, which Docusaurus exempts from trailing-slash rewriting', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/')?.ref).toBe('index')
  })

  it('returns undefined for an unmapped URL', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/unknown/')).toBeUndefined()
  })

  it('ignores non-canonical (isLast: false) version entries', async () => {
    setLocator()
    stubFetchJson({
      ...validManifest,
      documents: [
        ...validManifest.documents,
        {
          ref: 'getting-started',
          version: '1.0',
          versionPath: '/docs/1.0/',
          isLast: false,
          title: 'Getting Started (1.0)',
          permalink: '/docs/1.0/getting-started/',
          unlisted: false
        }
      ]
    })
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/1.0/getting-started/')).toBeUndefined()
  })

  it('caches the fetched manifest across calls', async () => {
    setLocator()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(validManifest) })
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadCorpusRefMap(SITE_CONFIG)
    await loadCorpusRefMap(SITE_CONFIG)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not share a cache entry between different site configurations', async () => {
    setLocator()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(validManifest) })
    )
    vi.stubGlobal('fetch', fetchMock)

    // The cache key includes the URL settings, so a later call can't silently
    // inherit the first call's normalization.
    const withTrailingSlash = await loadCorpusRefMap(SITE_CONFIG)
    const withoutTrailingSlash = await loadCorpusRefMap({ ...SITE_CONFIG, trailingSlash: false })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(withTrailingSlash.ok && withTrailingSlash.resolve('/docs/getting-started')?.ref).toBe(
      'getting-started'
    )
    expect(
      withoutTrailingSlash.ok && withoutTrailingSlash.resolve('/docs/getting-started/')?.ref
    ).toBe('getting-started')
  })

  it('does not share a cache entry between different manifest locators', async () => {
    setLocator()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(validManifest) })
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadCorpusRefMap(SITE_CONFIG)
    setLocator('/assets/docs-corpus/manifest.v1.redeployed.json')
    await loadCorpusRefMap(SITE_CONFIG)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries after a retryable failure instead of caching it forever', async () => {
    setLocator()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(validManifest)
      })
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadCorpusRefMap(SITE_CONFIG)
    expect(first).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: true })

    const second = await loadCorpusRefMap(SITE_CONFIG)
    expect(second.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports manifest_incompatible (not unavailable) for a malformed locator', async () => {
    __setPluginData('documentation-corpus', 'default', {
      schemaVersion: 1,
      manifestUrl: MANIFEST_URL
      // manifestHash omitted: the locator is published but unusable, which is
      // corpus/consumer drift rather than "the plugin was never registered".
    })
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('reports manifest_incompatible for a locator declaring a different schema version', async () => {
    __setPluginData('documentation-corpus', 'default', {
      schemaVersion: 2,
      manifestHash: 'abc123',
      manifestUrl: MANIFEST_URL
    })
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('schema version 2')
  })

  it('reports manifest_incompatible when the fetched manifest hash does not match the locator', async () => {
    setLocator()
    stubFetchJson({ ...validManifest, manifestHash: 'stale-hash' })
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('resolves an absolute URL hit against a relative manifest permalink', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('https://tiny.nntin.xyz/docs/getting-started/')?.ref).toBe(
      'getting-started'
    )
  })

  it('resolves a hit URL carrying a query string or fragment', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/getting-started/?highlight=install#installation')?.ref).toBe(
      'getting-started'
    )
  })
})
