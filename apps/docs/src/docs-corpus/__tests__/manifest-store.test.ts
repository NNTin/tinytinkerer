import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  loadDocumentationCorpusStore,
  resetDocumentationCorpusStoreForTests
} from '../manifest-store'

const MANIFEST_URL = '/assets/docs-corpus/manifest.v1.abc123.json'
// This site's real configuration: `resolveDocsBaseUrl` in apps/docs/site-config.ts
// returns `/docs/`, and docusaurus.config.ts sets `trailingSlash: true`.
const SITE_CONFIG = { baseUrl: '/docs/', trailingSlash: true }

/**
 * Exactly what build-corpus.ts hashes: SHA-256 over
 * `JSON.stringify({ schemaVersion, documents })`, i.e. the manifest without its
 * own hash field. Recomputed here from the same inputs rather than hard-coded,
 * so these fixtures stay honest if the canonicalization ever changes.
 */
const manifestHashOf = (documents: unknown[]): string =>
  createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, documents }))
    .digest('hex')

const entry = (overrides: Record<string, unknown> = {}) => ({
  ref: 'getting-started',
  version: 'current',
  versionPath: '/docs/',
  isLast: true,
  title: 'Getting Started',
  permalink: '/docs/getting-started/',
  source: '@site/../../docs/getting-started.md',
  contentHash: 'c'.repeat(64),
  artifactHash: 'a'.repeat(64),
  unlisted: false,
  artifact: '/docs/assets/docs-corpus/documents/current-getting-started.abc.def.json',
  characterCount: 1234,
  sectionCount: 7,
  ...overrides
})

const DOCUMENTS = [
  entry(),
  entry({ ref: 'index', title: 'TinyTinkerer documentation', permalink: '/docs/' }),
  entry({ ref: 'secret', title: 'Secret Page', permalink: '/docs/secret/', unlisted: true }),
  entry({
    ref: 'getting-started',
    version: '1.0',
    versionPath: '/docs/1.0/',
    isLast: false,
    title: 'Getting Started (1.0)',
    permalink: '/docs/1.0/getting-started/'
  })
]

const validManifest = {
  schemaVersion: 1,
  manifestHash: manifestHashOf(DOCUMENTS),
  documents: DOCUMENTS
}

const setLocator = (overrides: Record<string, unknown> = {}) => {
  __setPluginData('documentation-corpus', 'default', {
    schemaVersion: 1,
    manifestHash: validManifest.manifestHash,
    manifestUrl: MANIFEST_URL,
    ...overrides
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

describe('loadDocumentationCorpusStore', () => {
  beforeEach(() => {
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
  })

  it('reports manifest_unavailable when the corpus plugin has not published a locator', async () => {
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: false })
  })

  it('reports manifest_unavailable (retryable) on a non-OK manifest fetch', async () => {
    setLocator()
    stubFetchJson({}, { ok: false, status: 500 })
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: true })
  })

  it('reports manifest_incompatible when the payload does not match the #474 schema', async () => {
    setLocator()
    stubFetchJson({ schemaVersion: 1, manifestHash: 'x', documents: [{ ref: 'x' }] })
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('validates the whole manifest-entry contract, not just the fields search reads', async () => {
    // #477 loads a document body from `artifact`; validating only the search
    // projection would let it trust a field nothing ever checked.
    setLocator()
    const documents = DOCUMENTS.map((doc, index) =>
      index === 0 ? Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'artifact')) : doc
    )
    stubFetchJson({ schemaVersion: 1, manifestHash: manifestHashOf(documents), documents })
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('verifies the manifest hash against its actual contents, not just the locator', async () => {
    // Both `manifestHash` values are self-reported, so agreeing with each other
    // proves nothing about the payload under a content-addressed URL.
    setLocator()
    stubFetchJson({
      ...validManifest,
      documents: [entry({ title: 'Tampered Title' }), ...DOCUMENTS.slice(1)]
    })
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('integrity verification')
  })

  it('accepts a manifest whose contents hash to its advertised value', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
  })

  it('reports manifest_incompatible when the fetched manifest hash does not match the locator', async () => {
    setLocator({ manifestHash: 'stale-hash' })
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('stale-hash')
  })

  it('resolves a canonical entry by permalink, tolerating trailing-slash differences', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.store.findByPermalink('/docs/getting-started/')?.ref).toBe('getting-started')
    expect(outcome.store.findByPermalink('/docs/getting-started')?.ref).toBe('getting-started')
  })

  it('resolves the site root, which Docusaurus exempts from trailing-slash rewriting', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok && outcome.store.findByPermalink('/docs/')?.ref).toBe('index')
  })

  it('resolves an absolute URL, and one carrying a query string or fragment', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.store.findByPermalink('https://tiny.nntin.xyz/docs/getting-started/')?.ref).toBe(
      'getting-started'
    )
    expect(
      outcome.store.findByPermalink('/docs/getting-started/?highlight=install#installation')?.ref
    ).toBe('getting-started')
  })

  it('returns undefined for an unmapped URL', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok && outcome.store.findByPermalink('/docs/unknown/')).toBeUndefined()
  })

  it('never resolves a non-canonical version by permalink', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(
      outcome.ok && outcome.store.findByPermalink('/docs/1.0/getting-started/')
    ).toBeUndefined()
  })

  it('resolves a ref to the canonical version, or to a named one on request', async () => {
    // The lookup #477's `read_doc(ref)` needs, on the same store a search hit's
    // ref came from.
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.store.findByRef('getting-started')?.version).toBe('current')
    expect(outcome.store.findByRef('getting-started', '1.0')?.title).toBe('Getting Started (1.0)')
    expect(outcome.store.findByRef('nonexistent')).toBeUndefined()
  })

  it('exposes the full entry a document read needs', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.store.findByRef('getting-started')).toMatchObject({
      artifact: DOCUMENTS[0].artifact,
      artifactHash: DOCUMENTS[0].artifactHash,
      contentHash: DOCUMENTS[0].contentHash,
      characterCount: 1234,
      sectionCount: 7
    })
    expect(outcome.store.documents).toHaveLength(DOCUMENTS.length)
  })

  it('caches the fetched manifest across calls', async () => {
    setLocator()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(validManifest) })
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadDocumentationCorpusStore(SITE_CONFIG)
    await loadDocumentationCorpusStore(SITE_CONFIG)

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
    const withTrailingSlash = await loadDocumentationCorpusStore(SITE_CONFIG)
    const withoutTrailingSlash = await loadDocumentationCorpusStore({
      ...SITE_CONFIG,
      trailingSlash: false
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      withTrailingSlash.ok && withTrailingSlash.store.findByPermalink('/docs/getting-started')?.ref
    ).toBe('getting-started')
    expect(
      withoutTrailingSlash.ok &&
        withoutTrailingSlash.store.findByPermalink('/docs/getting-started/')?.ref
    ).toBe('getting-started')
  })

  it('does not share a cache entry between different manifest locators', async () => {
    setLocator()
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(validManifest) })
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadDocumentationCorpusStore(SITE_CONFIG)
    setLocator({ manifestUrl: '/assets/docs-corpus/manifest.v1.redeployed.json' })
    await loadDocumentationCorpusStore(SITE_CONFIG)

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

    const first = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(first).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: true })

    const second = await loadDocumentationCorpusStore(SITE_CONFIG)
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
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('reports manifest_incompatible for a locator declaring a different schema version', async () => {
    setLocator({ schemaVersion: 2 })
    stubFetchJson(validManifest)
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('schema version 2')
  })

  it('still loads when the platform offers no SubtleCrypto', async () => {
    // `crypto.subtle` is secure-context only; a docs site served over plain HTTP
    // must degrade to the locator/payload hash comparison rather than lose
    // retrieval entirely.
    setLocator()
    stubFetchJson(validManifest)
    vi.stubGlobal('crypto', {})
    const outcome = await loadDocumentationCorpusStore(SITE_CONFIG)
    expect(outcome.ok).toBe(true)
  })
})
