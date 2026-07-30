/**
 * Drives the **genuine** Docusaurus active-document machinery — the real
 * `useActiveDocContext` from `@docusaurus/plugin-content-docs@3.10.2`, over the
 * real `matchPath` from the same react-router copy Docusaurus' own client uses
 * (see apps/docs/vitest.config.ts) — against a real `<MemoryRouter>`.
 *
 * That is deliberate. Everything #476 must get right about routes (base URLs,
 * trailing slashes, versioned paths, generated index pages, deep links, 404s)
 * is decided by upstream's route matching, not by this repository, so a
 * hand-rolled stand-in for it would test the imitation instead of the contract.
 * The only stand-in here is the *transport* for global data
 * (`@docusaurus/useGlobalData`), which core normally supplies through a React
 * context a plain Vitest render cannot mount.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { MemoryRouter, useHistory } from '@docs-test/react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDocumentationCorpusStoreForTests } from '../../docs-corpus/manifest-store'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'
import {
  __resetDocusaurusGlobalData,
  __setDocusaurusGlobalData
} from '../../test/docusaurus-use-global-data-stub'
import {
  __resetSiteConfig,
  __setSiteConfig
} from '../../test/docusaurus-use-docusaurus-context-stub'
import { DocsPageProvider, useDocsPageContext } from '../docs-page-context'
import {
  assertFixtureStillMatchesSite,
  CANONICAL_DOCUMENT,
  GENERATED_INDEX_PATH,
  SITE_DOCUMENTS,
  siteGlobalData
} from './site-corpus-fixture'

const DOCS_PLUGIN = 'docusaurus-plugin-content-docs'
const MANIFEST_URL = '/docs/assets/docs-corpus/manifest.v1.abc123.json'

/** Exactly what build-corpus.ts hashes: the manifest without its own hash field. */
const manifestHashOf = (documents: unknown[]): string =>
  createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, documents }))
    .digest('hex')

const corpusEntry = (overrides: Record<string, unknown> = {}) => ({
  ...CANONICAL_DOCUMENT,
  ...overrides
})

const CORPUS_DOCUMENTS = SITE_DOCUMENTS

/** The payload a healthy build serves at `MANIFEST_URL`. */
const validManifest = (documents: unknown[] = CORPUS_DOCUMENTS) => ({
  schemaVersion: 1,
  manifestHash: manifestHashOf(documents),
  documents
})

/** What #474's build plugin puts in Docusaurus global data. */
const publishLocator = (manifestHash: string) => {
  __setPluginData('documentation-corpus', 'default', {
    schemaVersion: 1,
    manifestHash,
    manifestUrl: MANIFEST_URL
  })
}

const okResponse = (manifest: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(manifest)
})

const setCorpus = (documents: unknown[] = CORPUS_DOCUMENTS) => {
  const manifest = validManifest(documents)
  publishLocator(manifest.manifestHash)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(okResponse(manifest)))
  )
}

/** Hoisted out of the render the same way `navigate` is, for the retry tests. */
let retryCorpus: () => void = () => {
  throw new Error('retryCorpus used before render')
}

/**
 * Renders the whole context value as text. Reading it as one string is the
 * point: it makes an inconsistent pathname/identity pairing visible instead of
 * letting two separate assertions each pass against a different render.
 */
const Probe = () => {
  const context = useDocsPageContext()
  const { pathname, active } = context
  retryCorpus = context.retryCorpus
  const identity =
    active.status === 'document'
      ? `${active.document.ref}@${active.document.version} ${active.document.permalink}${
          active.document.unlisted ? ' unlisted' : ''
        }`
      : `none:${active.reason}`
  return <output data-testid="probe">{`${pathname} → ${identity}`}</output>
}

let navigate: (to: string) => void = () => {
  throw new Error('navigate used before render')
}

const Navigator = () => {
  const history = useHistory()
  navigate = (to) => history.push(to)
  return null
}

const renderAt = async (pathname: string) => {
  const result = render(
    <MemoryRouter initialEntries={[pathname]}>
      <Navigator />
      <DocsPageProvider>
        <Probe />
      </DocsPageProvider>
    </MemoryRouter>
  )
  // Let the corpus-manifest effect settle; every assertion below is about the
  // settled state, not the (separately asserted) pending one. Polled rather than
  // flushed a fixed number of times because the store's integrity check awaits
  // `crypto.subtle.digest`, whose scheduling is not ours to predict.
  await waitFor(() => {
    expect(probeText()).not.toContain('corpus_pending')
  })
  return result
}

const probeText = () => screen.getByTestId('probe').textContent

describe('DocsPageProvider', () => {
  assertFixtureStillMatchesSite()

  beforeEach(() => {
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
    __setDocusaurusGlobalData(DOCS_PLUGIN, 'default', siteGlobalData())
    setCorpus()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
  })

  it('resolves a normal authored docs route to its corpus ref and canonical permalink', async () => {
    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe(
      '/docs/architecture/packages-concept/ → architecture/packages-concept@current /docs/architecture/packages-concept/'
    )
  })

  it('resolves a deep link that omits the configured trailing slash', async () => {
    await renderAt('/docs/architecture/packages-concept')
    expect(probeText()).toBe(
      '/docs/architecture/packages-concept → architecture/packages-concept@current /docs/architecture/packages-concept/'
    )
  })

  it('resolves a direct visit to an unlisted document as the current document', async () => {
    await renderAt('/docs/updates/PRIVACY-UPDATE/')
    expect(probeText()).toBe(
      '/docs/updates/PRIVACY-UPDATE/ → updates/PRIVACY-UPDATE@current /docs/updates/PRIVACY-UPDATE/ unlisted'
    )
  })

  it('resolves the docs landing route, which this site authors as a real document', async () => {
    await renderAt('/docs/')
    expect(probeText()).toBe('/docs/ → documentation-home@current /docs/')
  })

  it('resolves a versioned route against that version rather than the canonical one', async () => {
    await renderAt('/docs/1.0/architecture/packages-concept/')
    expect(probeText()).toBe(
      '/docs/1.0/architecture/packages-concept/ → architecture/packages-concept@1.0 /docs/1.0/architecture/packages-concept/'
    )
  })

  it('exposes an explicit no-active-document state on the search route', async () => {
    await renderAt('/docs/search/')
    expect(probeText()).toBe('/docs/search/ → none:not_a_document_route')
  })

  it('exposes an explicit no-active-document state on a 404 route', async () => {
    await renderAt('/docs/does/not/exist/')
    expect(probeText()).toBe('/docs/does/not/exist/ → none:not_a_document_route')
  })

  it('exposes an explicit no-active-document state on a generated category index', async () => {
    await renderAt(GENERATED_INDEX_PATH)
    expect(probeText()).toBe(`${GENERATED_INDEX_PATH} → none:generated_index_route`)
  })

  it('updates the identity atomically on client-side navigation', async () => {
    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe(
      '/docs/architecture/packages-concept/ → architecture/packages-concept@current /docs/architecture/packages-concept/'
    )

    act(() => navigate('/docs/updates/PRIVACY-UPDATE/'))

    // One commit, both halves moved. There is no intermediate state in which the
    // new pathname is paired with the previous document — the identity is
    // derived during the same render the router updates, not copied into state
    // by an effect afterwards.
    expect(probeText()).toBe(
      '/docs/updates/PRIVACY-UPDATE/ → updates/PRIVACY-UPDATE@current /docs/updates/PRIVACY-UPDATE/ unlisted'
    )

    act(() => navigate('/docs/search/'))
    expect(probeText()).toBe('/docs/search/ → none:not_a_document_route')
  })

  it('resolves consistently under a different configured base URL', async () => {
    const documents = [
      corpusEntry({ versionPath: '/', permalink: '/architecture/packages-concept/' })
    ]
    __setDocusaurusGlobalData(DOCS_PLUGIN, 'default', {
      path: '/',
      breadcrumbs: true,
      versions: [
        {
          name: 'current',
          label: 'Next',
          isLast: true,
          path: '/',
          mainDocId: 'architecture/packages-concept',
          draftIds: [],
          docs: [{ id: 'architecture/packages-concept', path: '/architecture/packages-concept/' }]
        }
      ]
    })
    __setSiteConfig({ baseUrl: '/', trailingSlash: true })
    setCorpus(documents)

    await renderAt('/architecture/packages-concept/')
    expect(probeText()).toBe(
      '/architecture/packages-concept/ → architecture/packages-concept@current /architecture/packages-concept/'
    )
  })

  it('starts in an explicit pending state and never touches window during that render', () => {
    // A never-settling manifest request stands in for both static rendering and
    // the first hydration render: the provider must publish a usable state
    // without a corpus, and without reading anything from the document.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    render(
      <MemoryRouter initialEntries={['/docs/architecture/packages-concept/']}>
        <DocsPageProvider>
          <Probe />
        </DocsPageProvider>
      </MemoryRouter>
    )
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_pending')
  })

  it('answers non-document routes immediately, without waiting for the corpus', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    render(
      <MemoryRouter initialEntries={['/docs/search/']}>
        <DocsPageProvider>
          <Probe />
        </DocsPageProvider>
      </MemoryRouter>
    )
    expect(probeText()).toBe('/docs/search/ → none:not_a_document_route')
  })

  it('surfaces a corpus load failure instead of pretending the page has no document', async () => {
    __resetGlobalData()
    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_unavailable')
  })

  it('diagnoses an active document id the corpus manifest does not contain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setCorpus(CORPUS_DOCUMENTS.filter((document) => document.ref !== 'updates/PRIVACY-UPDATE'))

    await renderAt('/docs/updates/PRIVACY-UPDATE/')

    expect(probeText()).toBe('/docs/updates/PRIVACY-UPDATE/ → none:unknown_active_document')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('"updates/PRIVACY-UPDATE"')
  })

  it('reports each distinct mapping anomaly once, not on every render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setCorpus(CORPUS_DOCUMENTS.filter((document) => document.ref !== 'updates/PRIVACY-UPDATE'))

    await renderAt('/docs/updates/PRIVACY-UPDATE/')
    act(() => navigate('/docs/architecture/packages-concept/'))
    act(() => navigate('/docs/updates/PRIVACY-UPDATE/'))

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not diagnose a generated category index as corpus drift', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await renderAt(GENERATED_INDEX_PATH)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('DocsPageProvider corpus recovery', () => {
  assertFixtureStillMatchesSite()

  beforeEach(() => {
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
    __setDocusaurusGlobalData(DOCS_PLUGIN, 'default', siteGlobalData())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
  })

  it('recovers from a retryable manifest failure when a consumer retries', async () => {
    // The provider is mounted by `@theme/Root` for the lifetime of the SPA, and
    // neither `baseUrl` nor `trailingSlash` changes within a session — so
    // without an explicit retry a single 503 would make the corpus permanently
    // unavailable while the published state still claimed `retryable: true`.
    const manifest = validManifest()
    publishLocator(manifest.manifestHash)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValue(okResponse(manifest))
    vi.stubGlobal('fetch', fetchMock)

    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => retryCorpus())

    await waitFor(() => {
      expect(probeText()).toBe(
        '/docs/architecture/packages-concept/ → architecture/packages-concept@current /docs/architecture/packages-concept/'
      )
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('passes through pending on the way back, so no consumer reads a stale failure', async () => {
    const manifest = validManifest()
    publishLocator(manifest.manifestHash)
    let releaseSecond: (value: unknown) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseSecond = resolve
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_unavailable')

    act(() => retryCorpus())
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_pending')

    releaseSecond(okResponse(manifest))
    await waitFor(() => {
      expect(probeText()).toContain('architecture/packages-concept@current')
    })
  })

  it('does not re-fetch when the corpus already loaded', async () => {
    const manifest = validManifest()
    publishLocator(manifest.manifestHash)
    const fetchMock = vi.fn(() => Promise.resolve(okResponse(manifest)))
    vi.stubGlobal('fetch', fetchMock)

    await renderAt('/docs/architecture/packages-concept/')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => retryCorpus())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(probeText()).toContain('architecture/packages-concept@current')
  })

  it('does not re-fetch a manifest that will never validate', async () => {
    // A hash the payload does not carry is a deployment mismatch, not a blip:
    // `retryable` is false, so a consumer looping on failure must not be able
    // to turn it into an unbounded request loop.
    publishLocator('f'.repeat(64))
    const fetchMock = vi.fn(() => Promise.resolve(okResponse(validManifest())))
    vi.stubGlobal('fetch', fetchMock)

    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_incompatible')

    act(() => retryCorpus())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_incompatible')
  })

  it('reports an unpublished corpus as unavailable, not incompatible', async () => {
    // No locator in global data at all: nothing was fetched, so this is
    // `manifest_unavailable` even though it is not retryable.
    __resetGlobalData()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse({})))
    )

    await renderAt('/docs/architecture/packages-concept/')
    expect(probeText()).toBe('/docs/architecture/packages-concept/ → none:corpus_unavailable')
  })
})

describe('useDocsPageContext', () => {
  it('fails loudly outside the provider rather than reporting "no document"', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/DocsPageProvider/)
    error.mockRestore()
  })
})
