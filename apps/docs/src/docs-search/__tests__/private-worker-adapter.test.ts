import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PINNED_SEARCH_PLUGIN_VERSION,
  resetSearchWorkerModuleCacheForTests,
  searchPrivateWorker
} from '../private-worker-adapter'

const searchByWorkerMock = vi.hoisted(() => vi.fn())
const fetchIndexesByWorkerMock = vi.hoisted(() => vi.fn())
// Records whether the adapter has actually pulled the module in yet — the
// factory only runs on first import, which is what the lazy-load test asserts.
const moduleEvaluations = vi.hoisted(() => ({ count: 0 }))

// `vi.mock` is hoisted above the imports, so the specifier has to be a literal.
vi.mock('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js', () => {
  moduleEvaluations.count += 1
  return { searchByWorker: searchByWorkerMock, fetchIndexesByWorker: fetchIndexesByWorkerMock }
})

/**
 * Locates `apps/docs/package.json` from the workspace root rather than from
 * `process.cwd()`, so the pinned-version tripwire below reads the same manifest
 * whether Vitest was started in `apps/docs` or at the repository root.
 */
const docsPackageJsonPath = (): string => {
  let dir = process.cwd()
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return resolve(dir, 'apps/docs/package.json')
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not locate the workspace root from ' + process.cwd())
}

const BASE_URL = '/docs/'
const PAGE_URL = '/docs/getting-started/'

/** The parent Title document upstream attaches to every non-Title result. */
const pageDocument = { i: 1, t: 'Getting Started', u: PAGE_URL, b: ['Docs'] }

/**
 * Lunr match metadata as the worker really emits it (buildIndex.js indexes one
 * field, `t`, and whitelists one key, `position`).
 */
const positionMetadata = (...positions: [number, number][]) => ({
  instal: { t: { position: positions } }
})

const workerResult = (overrides: Record<string, unknown>) => ({
  document: { i: 2, t: 'Installation', u: PAGE_URL, h: '#installation', p: 1 },
  type: 1,
  page: pageDocument,
  metadata: positionMetadata([0, 12]),
  tokens: ['install'],
  score: 0.5,
  ...overrides
})

describe('searchPrivateWorker', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    searchByWorkerMock.mockReset()
    fetchIndexesByWorkerMock.mockReset()
    fetchIndexesByWorkerMock.mockResolvedValue(undefined)
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

  it('initializes the index before querying, with the base URL and an empty search context', async () => {
    searchByWorkerMock.mockResolvedValue([])
    await searchPrivateWorker(BASE_URL, 'install docs', 40)
    expect(fetchIndexesByWorkerMock).toHaveBeenCalledWith(BASE_URL, '')
    expect(searchByWorkerMock).toHaveBeenCalledTimes(1)
    expect(searchByWorkerMock).toHaveBeenCalledWith(BASE_URL, '', 'install docs', 40)
  })

  it('preserves the worker ordering and normalizes each document type', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: pageDocument,
        type: 0,
        page: false,
        metadata: positionMetadata([0, 7])
      }),
      workerResult({}),
      workerResult({
        document: {
          i: 6,
          t: 'Learn how to install the toolkit.',
          s: 'Getting Started',
          u: PAGE_URL,
          p: 1
        },
        type: 2,
        metadata: positionMetadata([13, 7])
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
        type: 4,
        metadata: positionMetadata([8, 9])
      })
    ])

    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.hits.map((hit) => hit.matchedText)).toEqual([
      'Getting Started',
      'Installation',
      'Learn how to install the toolkit.',
      'Run the installer script.'
    ])
    // A Title record has neither `s` nor `h`.
    expect(outcome.hits[0]).toMatchObject({ url: PAGE_URL, anchor: null, section: null })
    // A Heading record's own `t` IS its section title, and `h` becomes the anchor.
    expect(outcome.hits[1]).toMatchObject({ anchor: 'installation', section: 'Installation' })
    // A Description record's `s` is the page title; it has no anchor of its own.
    expect(outcome.hits[2]).toMatchObject({ anchor: null, section: 'Getting Started' })
    // A Content record's `s` is the enclosing heading's title.
    expect(outcome.hits[3]).toMatchObject({ anchor: 'installation', section: 'Installation' })
  })

  it('still names the section of a Heading record that renders no anchor', async () => {
    // Real shape: the production index carries `h: ""` for four headings under
    // /docs/contributing/. A Heading's own `t` is its section title whether or
    // not navigation can target it, so deriving `section` from field presence
    // rather than from the document type silently dropped it.
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: { i: 120, t: 'Security Issues', u: '/docs/contributing/', h: '', p: 116 },
        type: 1,
        page: { i: 116, t: 'Contributing', u: '/docs/contributing/', b: ['Docs'] },
        metadata: { secur: { t: { position: [[0, 8]] } } }
      })
    ])

    const outcome = await searchPrivateWorker(BASE_URL, 'security', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hits[0]).toMatchObject({ anchor: null, section: 'Security Issues' })
  })

  it('normalizes lunr match metadata into ordered match ranges', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: {
          i: 3,
          t: 'Install first, then reinstall the installer.',
          s: 'Installation',
          u: PAGE_URL,
          h: '#installation',
          p: 1
        },
        type: 4,
        metadata: {
          // Deliberately out of order, and spread across two stemmed terms —
          // getStemmedPositions sorts by start ascending, length descending.
          reinstal: { t: { position: [[20, 9]] } },
          instal: {
            t: {
              position: [
                [34, 9],
                [0, 7]
              ]
            }
          }
        }
      })
    ])

    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.hits[0].matchRanges).toEqual([
      { start: 0, length: 7 },
      { start: 20, length: 9 },
      { start: 34, length: 9 }
    ])
  })

  it('reports index_incompatible when a hit carries no match positions', async () => {
    // Provable drift for this pinned version, not a judgement call: buildIndex.js
    // indexes only `t` and whitelists only `position`, so a positive lunr result
    // necessarily matched that field and necessarily records its offsets.
    // Verified across 1,590 real worker results (types 0/1/2/4) on the
    // production index: none lacked them.
    searchByWorkerMock.mockResolvedValue([workerResult({ metadata: {} })])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('no "t" field positions')
  })

  it('reports index_incompatible when metadata only carries a field the index never had', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ metadata: { instal: { body: { position: [[0, 7]] } } } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('reports index_incompatible when a match position falls outside the indexed text', async () => {
    // The public snippet is built from these offsets, so a position that does
    // not index into `document.t` is contract drift, not a rounding detail.
    searchByWorkerMock.mockResolvedValue([workerResult({ metadata: positionMetadata([9000, 7]) })])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('does not fall inside')
  })

  it('reports index_incompatible when a match position is not a [start, length] pair', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ metadata: { instal: { t: { position: [[0]] } } } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('reports index_unavailable as NOT retryable when index initialization fails', async () => {
    // Upstream memoizes even a rejected index fetch inside the worker, so an
    // in-session retry would replay the same failure.
    fetchIndexesByWorkerMock.mockRejectedValue(new Error('Failed to fetch'))
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_unavailable', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('reload the page')
    expect(outcome.ok === false && outcome.message).toContain('Failed to fetch')
    expect(searchByWorkerMock).not.toHaveBeenCalled()
  })

  it('does not claim a reload is needed when the query fails after the index loaded', async () => {
    // Only `lowLevelFetchIndexes` memoizes its promise. A throw from the
    // worker's own tokenize/query/sort path is contract drift, and reloading
    // would reproduce it forever.
    searchByWorkerMock.mockRejectedValue(new TypeError('r.query is not a function'))
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(fetchIndexesByWorkerMock).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('r.query is not a function')
    expect(outcome.ok === false && outcome.message).not.toContain('reload the page')
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
      workerResult({ page: { i: 99, t: 'Other Page', u: '/docs/other/', b: ['Docs'] } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('resolved parent page 99')
  })

  it('reports index_incompatible for a Title result with no breadcrumb', async () => {
    // `parseDocument.js`/`parsePage.js` both initialise `breadcrumb` to `[]` and
    // always return it, so a Title record without `b` is drift, not an upstream
    // variation. (An empty array is normal and accepted — see below.)
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: { i: 1, t: 'Getting Started', u: PAGE_URL },
        type: 0,
        page: false,
        metadata: positionMetadata([0, 7])
      })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'started', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('field shape')
  })

  it('reports index_incompatible for a parent page with no breadcrumb', async () => {
    // Every non-Title result carries its parent Title document, which is subject
    // to the same shape rule.
    searchByWorkerMock.mockResolvedValue([
      workerResult({ page: { i: 1, t: 'Getting Started', u: PAGE_URL } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('reports index_incompatible for a malformed breadcrumb', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: { i: 1, t: 'Getting Started', u: PAGE_URL, b: [42] },
        type: 0,
        page: false,
        metadata: positionMetadata([0, 7])
      })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'started', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
  })

  it('accepts an empty breadcrumb, which upstream emits for a page with no sidebar trail', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: { i: 1, t: 'Getting Started', u: PAGE_URL, b: [] },
        type: 0,
        page: false,
        metadata: positionMetadata([0, 7])
      })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'started', 10)
    expect(outcome.ok).toBe(true)
  })

  it('reports index_incompatible when a result sits on a different page than its parent', async () => {
    // The dangerous variant of the same drift: ids agree, URLs do not, so the
    // hit's text would be cited against another page's corpus ref.
    searchByWorkerMock.mockResolvedValue([
      workerResult({ page: { i: 1, t: 'Other Page', u: '/docs/other/', b: ['Docs'] } })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('/docs/other/')
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

  it('reports index_incompatible when a document carries a field its type never emits', async () => {
    // scanDocuments.js never puts `s` on a Heading record — `section`'s
    // derivation depends on exactly that.
    searchByWorkerMock.mockResolvedValue([
      workerResult({
        document: {
          i: 2,
          t: 'Installation',
          s: 'Getting Started',
          u: PAGE_URL,
          h: '#installation',
          p: 1
        }
      })
    ])
    const outcome = await searchPrivateWorker(BASE_URL, 'install', 10)
    expect(outcome).toMatchObject({ ok: false, code: 'index_incompatible', retryable: false })
    expect(outcome.ok === false && outcome.message).toContain('field shape')
  })

  it('reports index_incompatible for a non-integer document id', async () => {
    searchByWorkerMock.mockResolvedValue([
      workerResult({ document: { i: 2.5, t: 'Installation', u: PAGE_URL, h: '#x', p: 1 } })
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
    // private-worker-adapter.ts must stay the only production module that imports
    // package internals. This failing is a tripwire pointing at the upgrade
    // checklist in apps/docs/src/docs-search/README.md, not a substitute for
    // working through it.
    const manifest = JSON.parse(readFileSync(docsPackageJsonPath(), 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    // Guards against this resolving to some other manifest, which would
    // otherwise make the tripwire silently vacuous.
    expect(manifest.name).toBe('@tinytinkerer/docs')
    const declared =
      manifest.dependencies?.['@easyops-cn/docusaurus-search-local'] ??
      manifest.devDependencies?.['@easyops-cn/docusaurus-search-local']
    expect(declared).toBe(PINNED_SEARCH_PLUGIN_VERSION)
  })
})
