import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import { loadCorpusRefMap, resetCorpusRefMapCacheForTests } from '../corpus-ref-map'

const MANIFEST_URL = '/assets/docs-corpus/manifest.v1.abc123.json'

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
    const outcome = await loadCorpusRefMap()
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: false })
  })

  it('reports manifest_unavailable (retryable) on a non-OK manifest fetch', async () => {
    setLocator()
    stubFetchJson({}, { ok: false, status: 500 })
    const outcome = await loadCorpusRefMap()
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_unavailable', retryable: true })
  })

  it('reports manifest_incompatible when the payload does not match the #474 schema', async () => {
    setLocator()
    stubFetchJson({ schemaVersion: 1, documents: [{ ref: 'x' }] })
    const outcome = await loadCorpusRefMap()
    expect(outcome).toMatchObject({ ok: false, code: 'manifest_incompatible', retryable: false })
  })

  it('resolves a matching entry by permalink, tolerating trailing-slash differences', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap()
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.resolve('/docs/getting-started/')?.ref).toBe('getting-started')
    expect(outcome.resolve('/docs/getting-started')?.ref).toBe('getting-started')
  })

  it('returns undefined for an unmapped URL', async () => {
    setLocator()
    stubFetchJson(validManifest)
    const outcome = await loadCorpusRefMap()
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
    const outcome = await loadCorpusRefMap()
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

    await loadCorpusRefMap()
    await loadCorpusRefMap()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
