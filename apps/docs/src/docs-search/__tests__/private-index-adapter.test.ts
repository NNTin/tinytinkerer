import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFixtureSearchIndex,
  PAGE_A_URL,
  PAGE_B_URL
} from '../__fixtures__/build-fixture-index'
import { resetPrivateIndexCacheForTests, searchPrivateIndex } from '../private-index-adapter'

const BASE_URL = '/'

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

describe('searchPrivateIndex', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetPrivateIndexCacheForTests()
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    vi.unstubAllGlobals()
    resetPrivateIndexCacheForTests()
  })

  it('reports index_dev_unsupported outside production, without fetching', async () => {
    process.env.NODE_ENV = 'test'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)

    expect(outcome).toMatchObject({ ok: false, code: 'index_dev_unsupported', retryable: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns a valid empty result for a query with no indexable tokens', async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, '   ', 10)
    expect(outcome).toEqual({ ok: true, hits: [] })
  })

  it('finds matches across the heading and content indexes, mapped to neutral hits', async () => {
    stubFetchJson(buildFixtureSearchIndex())

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hits.length).toBeGreaterThan(0)
    expect(outcome.hits.every((hit) => hit.url === PAGE_A_URL)).toBe(true)
    // The heading/content docs surface their trimmed anchor (no leading `#`).
    expect(outcome.hits.some((hit) => hit.anchor === 'installation')).toBe(true)
  })

  it('gives a title match a null anchor', async () => {
    stubFetchJson(buildFixtureSearchIndex())

    const outcome = await searchPrivateIndex(BASE_URL, 'started', 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const titleHit = outcome.hits.find((hit) => hit.matchedText === 'Getting Started')
    expect(titleHit?.anchor).toBeNull()
  })

  it('finds matches on a second page independently', async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'hashing', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hits.some((hit) => hit.url === PAGE_B_URL)).toBe(true)
  })

  it('caches the fetched index across calls', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildFixtureSearchIndex())
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await searchPrivateIndex(BASE_URL, 'install', 10)
    await searchPrivateIndex(BASE_URL, 'hashing', 10)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports index_unavailable (retryable) on a non-OK HTTP response', async () => {
    stubFetchJson({}, { ok: false, status: 404 })
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_unavailable', retryable: true })
  })

  it('reports index_unavailable (retryable) when the fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    )
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_unavailable', retryable: true })
    expect((outcome as { message: string }).message).toContain('network down')
  })

  it('reports index_incompatible with an actionable message when the group count drifts', async () => {
    const fixture = buildFixtureSearchIndex()
    stubFetchJson(fixture.slice(0, 4)) // drop the content group — simulates an upstream shape change
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect((outcome as { message: string }).message).toMatch(/5 search index groups/)
  })

  it('reports index_incompatible when a document is missing required fields', async () => {
    const fixture = buildFixtureSearchIndex() as Array<{ documents: unknown[]; index: object }>
    // Simulate a renamed field (e.g. `u` -> `url`) in an upstream release.
    fixture[0].documents = [{ i: 1, t: 'Getting Started', url: PAGE_A_URL }]
    stubFetchJson(fixture)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect((outcome as { message: string }).message).toContain('index group 0')
  })

  it('reports index_incompatible when the index blob itself fails to load', async () => {
    const fixture = buildFixtureSearchIndex() as Array<{ documents: unknown[]; index: object }>
    fixture[0].index = { not: 'a real lunr index' }
    stubFetchJson(fixture)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })
})
