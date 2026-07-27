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

const DOCS_PLUGIN = 'docusaurus-plugin-content-docs'
const MANIFEST_URL = '/docs/assets/docs-corpus/manifest.v1.abc123.json'

/** Exactly what build-corpus.ts hashes: the manifest without its own hash field. */
const manifestHashOf = (documents: unknown[]): string =>
  createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, documents }))
    .digest('hex')

const corpusEntry = (overrides: Record<string, unknown> = {}) => ({
  ref: 'architecture/overview',
  version: 'current',
  versionPath: '/docs/',
  isLast: true,
  title: 'Architecture overview',
  permalink: '/docs/architecture/overview/',
  source: '@site/../../docs/architecture/overview.md',
  contentHash: 'c'.repeat(64),
  artifactHash: 'a'.repeat(64),
  unlisted: false,
  artifact: '/docs/assets/docs-corpus/documents/current-architecture-overview.abc.def.json',
  characterCount: 4321,
  sectionCount: 9,
  ...overrides
})

const CORPUS_DOCUMENTS = [
  corpusEntry(),
  corpusEntry({ ref: 'index', title: 'TinyTinkerer documentation', permalink: '/docs/' }),
  corpusEntry({ ref: 'secret', title: 'Secret page', permalink: '/docs/secret/', unlisted: true }),
  corpusEntry({
    version: '1.0',
    versionPath: '/docs/1.0/',
    isLast: false,
    title: 'Architecture overview (1.0)',
    permalink: '/docs/1.0/architecture/overview/'
  })
]

/**
 * Mirrors what `toGlobalDataVersion` publishes for this site: authored docs,
 * unlisted docs (still routed, still in the list), and generated category
 * indices carrying their slug as an id. Drafts are absent by construction —
 * Docusaurus keeps them in `draftIds`, never in `docs`.
 */
const docsGlobalData = (documents = CORPUS_DOCUMENTS) => ({
  path: '/docs/',
  breadcrumbs: true,
  versions: [
    {
      name: 'current',
      label: 'Next',
      isLast: true,
      path: '/docs/',
      mainDocId: 'index',
      draftIds: [],
      docs: [
        ...documents
          .filter((document) => document.isLast)
          .map((document) => ({
            id: document.ref,
            path: document.permalink,
            ...(document.unlisted ? { unlisted: true } : {})
          })),
        { id: '/category/architecture', path: '/docs/category/architecture/' }
      ]
    },
    {
      name: '1.0',
      label: '1.0',
      isLast: false,
      path: '/docs/1.0/',
      mainDocId: 'index',
      draftIds: [],
      docs: documents
        .filter((document) => !document.isLast)
        .map((document) => ({ id: document.ref, path: document.permalink }))
    }
  ]
})

const setCorpus = (documents: unknown[] = CORPUS_DOCUMENTS) => {
  const manifest = {
    schemaVersion: 1,
    manifestHash: manifestHashOf(documents),
    documents
  }
  __setPluginData('documentation-corpus', 'default', {
    schemaVersion: 1,
    manifestHash: manifest.manifestHash,
    manifestUrl: MANIFEST_URL
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(manifest) }))
  )
}

/**
 * Renders the whole context value as text. Reading it as one string is the
 * point: it makes an inconsistent pathname/identity pairing visible instead of
 * letting two separate assertions each pass against a different render.
 */
const Probe = () => {
  const { pathname, active } = useDocsPageContext()
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
  beforeEach(() => {
    resetDocumentationCorpusStoreForTests()
    __resetGlobalData()
    __resetDocusaurusGlobalData()
    __resetSiteConfig()
    __setDocusaurusGlobalData(DOCS_PLUGIN, 'default', docsGlobalData())
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
    await renderAt('/docs/architecture/overview/')
    expect(probeText()).toBe(
      '/docs/architecture/overview/ → architecture/overview@current /docs/architecture/overview/'
    )
  })

  it('resolves a deep link that omits the configured trailing slash', async () => {
    await renderAt('/docs/architecture/overview')
    expect(probeText()).toBe(
      '/docs/architecture/overview → architecture/overview@current /docs/architecture/overview/'
    )
  })

  it('resolves a direct visit to an unlisted document as the current document', async () => {
    await renderAt('/docs/secret/')
    expect(probeText()).toBe('/docs/secret/ → secret@current /docs/secret/ unlisted')
  })

  it('resolves the docs landing route, which this site authors as a real document', async () => {
    await renderAt('/docs/')
    expect(probeText()).toBe('/docs/ → index@current /docs/')
  })

  it('resolves a versioned route against that version rather than the canonical one', async () => {
    await renderAt('/docs/1.0/architecture/overview/')
    expect(probeText()).toBe(
      '/docs/1.0/architecture/overview/ → architecture/overview@1.0 /docs/1.0/architecture/overview/'
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
    await renderAt('/docs/category/architecture/')
    expect(probeText()).toBe('/docs/category/architecture/ → none:generated_index_route')
  })

  it('updates the identity atomically on client-side navigation', async () => {
    await renderAt('/docs/architecture/overview/')
    expect(probeText()).toBe(
      '/docs/architecture/overview/ → architecture/overview@current /docs/architecture/overview/'
    )

    act(() => navigate('/docs/secret/'))

    // One commit, both halves moved. There is no intermediate state in which the
    // new pathname is paired with the previous document — the identity is
    // derived during the same render the router updates, not copied into state
    // by an effect afterwards.
    expect(probeText()).toBe('/docs/secret/ → secret@current /docs/secret/ unlisted')

    act(() => navigate('/docs/search/'))
    expect(probeText()).toBe('/docs/search/ → none:not_a_document_route')
  })

  it('resolves consistently under a different configured base URL', async () => {
    const documents = [corpusEntry({ versionPath: '/', permalink: '/architecture/overview/' })]
    __setDocusaurusGlobalData(DOCS_PLUGIN, 'default', {
      path: '/',
      breadcrumbs: true,
      versions: [
        {
          name: 'current',
          label: 'Next',
          isLast: true,
          path: '/',
          mainDocId: 'architecture/overview',
          draftIds: [],
          docs: [{ id: 'architecture/overview', path: '/architecture/overview/' }]
        }
      ]
    })
    __setSiteConfig({ baseUrl: '/', trailingSlash: true })
    setCorpus(documents)

    await renderAt('/architecture/overview/')
    expect(probeText()).toBe(
      '/architecture/overview/ → architecture/overview@current /architecture/overview/'
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
      <MemoryRouter initialEntries={['/docs/architecture/overview/']}>
        <DocsPageProvider>
          <Probe />
        </DocsPageProvider>
      </MemoryRouter>
    )
    expect(probeText()).toBe('/docs/architecture/overview/ → none:corpus_pending')
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
    await renderAt('/docs/architecture/overview/')
    expect(probeText()).toBe('/docs/architecture/overview/ → none:corpus_unavailable')
  })

  it('diagnoses an active document id the corpus manifest does not contain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setCorpus(CORPUS_DOCUMENTS.filter((document) => document.ref !== 'secret'))

    await renderAt('/docs/secret/')

    expect(probeText()).toBe('/docs/secret/ → none:unknown_active_document')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('"secret"')
  })

  it('reports each distinct mapping anomaly once, not on every render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setCorpus(CORPUS_DOCUMENTS.filter((document) => document.ref !== 'secret'))

    await renderAt('/docs/secret/')
    act(() => navigate('/docs/architecture/overview/'))
    act(() => navigate('/docs/secret/'))

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not diagnose a generated category index as corpus drift', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await renderAt('/docs/category/architecture/')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useDocsPageContext', () => {
  it('fails loudly outside the provider rather than reporting "no document"', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/DocsPageProvider/)
    error.mockRestore()
  })
})
