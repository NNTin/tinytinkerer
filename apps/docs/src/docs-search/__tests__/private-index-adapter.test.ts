import { createRequire } from 'node:module'
import lunr from 'lunr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFixtureSearchIndex,
  buildNaturalLanguageFixtureSearchIndex,
  PAGE_A_URL,
  PAGE_B_URL,
  PAGE_C_URL,
  PAGE_D_URL,
  PAGE_E_URL
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

  it('reports index_incompatible with an actionable message when the group count drops', async () => {
    const fixture = buildFixtureSearchIndex()
    stubFetchJson(fixture.slice(0, 4)) // drop the content group — simulates an upstream shape change
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect((outcome as { message: string }).message).toMatch(/exactly 5 search index groups/)
  })

  it('reports index_incompatible when the group count grows (e.g. an unconfigured AskAI group)', async () => {
    const fixture = buildFixtureSearchIndex()
    stubFetchJson([...fixture, fixture[4]]) // 6 groups — previously silently accepted and sliced
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect((outcome as { message: string }).message).toMatch(/exactly 5 search index groups/)
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

  it('reports index_incompatible when a document breadcrumb field is not a string array', async () => {
    const fixture = buildFixtureSearchIndex() as Array<{ documents: unknown[]; index: object }>
    fixture[0].documents = [{ i: 1, t: 'Getting Started', u: PAGE_A_URL, b: [42] }]
    stubFetchJson(fixture)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('reports index_incompatible when a group has a duplicate document id', async () => {
    const fixture = buildFixtureSearchIndex() as Array<{ documents: unknown[]; index: object }>
    fixture[0].documents = [
      { i: 1, t: 'Getting Started', u: PAGE_A_URL },
      { i: 1, t: 'Duplicate', u: PAGE_B_URL }
    ]
    stubFetchJson(fixture)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect((outcome as { message: string }).message).toContain('duplicate document id')
  })

  it('reports index_incompatible when the index blob itself fails to load', async () => {
    const fixture = buildFixtureSearchIndex() as Array<{ documents: unknown[]; index: object }>
    fixture[0].index = { not: 'a real lunr index' }
    stubFetchJson(fixture)

    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('retries after a retryable failure instead of caching it forever', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildFixtureSearchIndex())
      })
    vi.stubGlobal('fetch', fetchMock)

    const first = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(first).toMatchObject({ ok: false, code: 'index_unavailable', retryable: true })

    const second = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(second.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('searchPrivateIndex section derivation', () => {
  beforeEach(() => {
    resetPrivateIndexCacheForTests()
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetPrivateIndexCacheForTests()
  })

  it('gives a title match a null section', async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'started', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const titleHit = outcome.hits.find((hit) => hit.matchedText === 'Getting Started')
    expect(titleHit?.section).toBeNull()
  })

  it("derives a heading match's section as its own heading title", async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const headingHit = outcome.hits.find((hit) => hit.matchedText === 'Installation')
    expect(headingHit?.section).toBe('Installation')
  })

  it("derives a content match's section as its enclosing heading title", async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const contentHit = outcome.hits.find((hit) =>
      hit.matchedText.startsWith('Run the installer script')
    )
    expect(contentHit?.section).toBe('Installation')
  })

  it("derives a description match's section as the page title when there is no enclosing heading", async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const descriptionHit = outcome.hits.find((hit) =>
      hit.matchedText.startsWith('Learn how to install')
    )
    expect(descriptionHit?.section).toBe('Getting Started')
  })
})

describe('searchPrivateIndex progressive query relaxation', () => {
  beforeEach(() => {
    resetPrivateIndexCacheForTests()
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetPrivateIndexCacheForTests()
  })

  it('finds a page via the leave-one-out tier when not every query word co-occurs (4 content words)', async () => {
    stubFetchJson(buildNaturalLanguageFixtureSearchIndex())
    const outcome = await searchPrivateIndex(
      BASE_URL,
      'where can I find plugin infrastructure guides',
      10
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hits.some((hit) => hit.url === PAGE_C_URL)).toBe(true)
  })

  it('finds both pages via the last-resort single-word tier for a 2-content-word question', async () => {
    stubFetchJson(buildNaturalLanguageFixtureSearchIndex())
    const outcome = await searchPrivateIndex(BASE_URL, 'how can I host WidgetKit', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const urls = outcome.hits.map((hit) => hit.url)
    expect(urls).toContain(PAGE_D_URL)
    expect(urls).toContain(PAGE_E_URL)
  })

  it('does not attempt looser tiers once the exact tier already satisfies the requested limit', async () => {
    stubFetchJson(buildFixtureSearchIndex())
    const querySpy = vi.spyOn(lunr.Index.prototype, 'query')
    const outcome = await searchPrivateIndex(BASE_URL, 'install configure', 2)
    expect(outcome.ok).toBe(true)
    // One query per of the 5 index groups, exact tier only — the query has no
    // stopwords (so tier B never applies) and would otherwise also try 2
    // leave-one-out variants across 5 groups (tier C) if escalation fired.
    expect(querySpy).toHaveBeenCalledTimes(5)
    querySpy.mockRestore()
  })
})

describe('pinned @easyops-cn/docusaurus-search-local version', () => {
  it('is still 0.55.2 — a bump should trigger the upgrade checklist in README.md', () => {
    const require = createRequire(import.meta.url)
    const pkg = require('@easyops-cn/docusaurus-search-local/package.json') as { version: string }
    expect(pkg.version).toBe('0.55.2')
  })
})
