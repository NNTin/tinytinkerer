import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PINNED_SEARCH_PLUGIN_VERSION,
  resetSearchWorkerModuleCacheForTests,
  searchPrivateWorker
} from '../private-worker-adapter'

const searchByWorkerMock = vi.hoisted(() => vi.fn())
// Records whether the adapter has actually pulled the module in yet — the
// factory only runs on first import, which is what the lazy-load test asserts.
const moduleEvaluations = vi.hoisted(() => ({ count: 0 }))

// `vi.mock` is hoisted above the imports, so the specifier has to be a literal.
vi.mock('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js', () => {
  moduleEvaluations.count += 1
  return { searchByWorker: searchByWorkerMock, fetchIndexesByWorker: vi.fn() }
})

const BASE_URL = '/docs/'
const PAGE_URL = '/docs/getting-started/'

/** The parent Title document upstream attaches to every non-Title result. */
const pageDocument = { i: 1, t: 'Getting Started', u: PAGE_URL, b: ['Docs'] }

const workerResult = (overrides: Record<string, unknown>) => ({
  document: { i: 2, t: 'Installation', u: PAGE_URL, h: '#installation', p: 1 },
  type: 1,
  page: pageDocument,
  metadata: {},
  tokens: ['install'],
  score: 0.5,
  ...overrides
})

describe('searchPrivateWorker', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    searchByWorkerMock.mockReset()
    resetSearchWorkerModuleCacheForTests()
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    resetSearchWorkerModuleCacheForTests()
  })

  it('reports index_dev_unsupported outside a production build', async () => {
    process.env.NODE_ENV = 'test'
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({
      ok: false,
      code: 'index_dev_unsupported',
      retryable: false
    })
    expect(searchByWorkerMock).not.toHaveBeenCalled()
  })

  // Must stay the first test that runs a search: the module registry is shared
  // across this file, so the mock factory only ever evaluates once.
  it('imports the worker module lazily on first search, then reuses it', async () => {
    // #475: "No search worker or index is loaded merely by opening a
    // documentation page or the assistant." Importing this adapter must not be
    // enough to pull the plugin's worker chunk in.
    expect(moduleEvaluations.count).toBe(0)

    searchByWorkerMock.mockResolvedValue([])
    await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(moduleEvaluations.count).toBe(1)

    // A second search must not import a second copy — one module instance is
    // what makes the worker (and its index) shared with the theme's search bar.
    await searchPrivateWorker(BASE_URL, 'configure', 10)
    expect(moduleEvaluations.count).toBe(1)
    expect(searchByWorkerMock).toHaveBeenCalledTimes(2)
  })

  it('delegates to the pinned worker with the site base URL and an empty search context', async () => {
    searchByWorkerMock.mockResolvedValue([])
    await searchPrivateWorker(BASE_URL, 'install docs', 40)
    expect(searchByWorkerMock).toHaveBeenCalledTimes(1)
    expect(searchByWorkerMock).toHaveBeenCalledWith(BASE_URL, '', 'install docs', 40)
  })

  it('preserves the worker ordering and normalizes each document type', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ document: pageDocument, type: 0, page: false }),
      workerResult({}),
      workerResult({
        document: {
          i: 6,
          t: 'Learn how to install the toolkit.',
          s: 'Getting Started',
          u: PAGE_URL,
          p: 1
        },
        type: 2
      }),
      workerResult({
        document: {
          i: 3,
          t: 'Run the installer script.',
          s: 'Installation',
          u: PAGE_URL,
          h: '#installation',
          p: 1
        },
        type: 4
      })
    ])

    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.hits.map((hit) => hit.order)).toEqual([0, 1, 2, 3])
    // A Title record has neither `s` nor `h`.
    expect(outcome.hits[0]).toMatchObject({
      url: PAGE_URL,
      anchor: null,
      section: null,
      matchedText: 'Getting Started',
      isPageTitle: true
    })
    // A Heading record's own `t` IS its section title, and `h` becomes the anchor.
    expect(outcome.hits[1]).toMatchObject({
      anchor: 'installation',
      section: 'Installation',
      matchedText: 'Installation',
      isPageTitle: false
    })
    // A Description record's `s` is the page title; it has no anchor of its own.
    expect(outcome.hits[2]).toMatchObject({ anchor: null, section: 'Getting Started' })
    // A Content record's `s` is the enclosing heading's title.
    expect(outcome.hits[3]).toMatchObject({ anchor: 'installation', section: 'Installation' })
  })

  it('reports index_unavailable as NOT retryable when the worker fails, with reload guidance', async () => {
    // Upstream memoizes even a rejected index fetch inside the worker, so an
    // in-session retry would replay the same failure.
    searchByWorkerMock.mockRejectedValue(new Error('Failed to fetch'))
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_unavailable', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('reload the page')
    expect(outcome.ok === false && outcome.message).toContain('Failed to fetch')
  })

  it('reports index_incompatible when a result carries no document', async () => {
    // Upstream's `documents.find(...)` returns undefined when the serialized
    // lunr index matches a ref its own documents[] no longer contains. Without
    // this check that degrades to a valid-looking zero result.
    searchByWorkerMock.mockResolvedValue([workerResult({ document: undefined })])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('absent from its own documents')
  })

  it('reports index_incompatible when a result has no resolvable parent page', async () => {
    searchByWorkerMock.mockResolvedValue([workerResult({ page: undefined })])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('no resolvable parent page')
  })

  it('reports index_incompatible when a result parent page contradicts the document', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ page: { i: 99, t: 'Other Page', u: '/docs/other/' } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('resolved parent page 99')
  })

  it('reports index_incompatible for a document type outside the five configured groups', async () => {
    // `AskAI = 5` only exists when `searchLocalOptions.askAi` is set, which
    // this site never sets.
    searchByWorkerMock.mockResolvedValue([workerResult({ type: 5 })])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('document type 5')
  })

  it('reports index_incompatible when a document is missing required fields', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ document: { i: 2, t: 'Installation', h: '#installation', p: 1 } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('reports index_incompatible when the worker returns a non-array', async () => {
    searchByWorkerMock.mockResolvedValue({})
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('treats an empty worker response as a valid zero-result search', async () => {
    searchByWorkerMock.mockResolvedValue([])
    const outcome = await searchPrivateWorker(BASE_URL, 'xyznonexistentterm', 10)
    expect(outcome).toEqual({ ok: true, hits: [] })
  })

  it('is still pinned to the search plugin version its assumptions were read from', () => {
    // Deliberately reads *our* manifest, not the plugin's private package.json:
    // private-worker-adapter.ts must stay the only module that imports package
    // internals. This failing is a tripwire pointing at the upgrade checklist in
    // apps/docs/src/docs-search/README.md, not a substitute for working through it.
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    // Guards against this resolving to some other manifest if the Vitest root
    // ever moves, which would otherwise make the tripwire silently vacuous.
    expect(manifest.name).toBe('@tinytinkerer/docs')
    const declared =
      manifest.dependencies?.['@easyops-cn/docusaurus-search-local'] ??
      manifest.devDependencies?.['@easyops-cn/docusaurus-search-local']
    expect(declared).toBe(PINNED_SEARCH_PLUGIN_VERSION)
  })
})
