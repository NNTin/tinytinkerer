/**
 * Route → authored-document resolution rules, exercised without React.
 *
 * The React integration (docs-page-context.test.tsx) drives the genuine
 * Docusaurus active-doc context to prove the *inputs* here are the ones a real
 * route produces; this file pins what is done with them.
 */
import { describe, expect, it } from 'vitest'
import type { DocumentationCorpusManifestEntry } from '@tinytinkerer/app-browser/documentation-corpus'
import {
  resolveDocsPageContext,
  type DocsCorpusLookup,
  type DocsPageResolution
} from '../active-document'
import {
  assertFixtureStillMatchesSite,
  CANONICAL_DOCUMENT,
  GENERATED_INDEX_ID,
  GENERATED_INDEX_PATH,
  SITE_CONFIG,
  SITE_DOCUMENTS
} from './site-corpus-fixture'

const entry = (
  overrides: Partial<DocumentationCorpusManifestEntry> = {}
): DocumentationCorpusManifestEntry => ({ ...CANONICAL_DOCUMENT, ...overrides })

const DOCUMENTS = SITE_DOCUMENTS

const readyCorpus = (
  documents: DocumentationCorpusManifestEntry[] = DOCUMENTS
): DocsCorpusLookup => ({
  status: 'ready',
  store: {
    findByRef: (ref, version) =>
      documents.find(
        (document) =>
          document.ref === ref &&
          (version === undefined ? document.isLast : document.version === version)
      )
  }
})

const resolve = (
  route: Parameters<typeof resolveDocsPageContext>[0],
  corpus: DocsCorpusLookup = readyCorpus(),
  siteConfig = SITE_CONFIG
): DocsPageResolution => resolveDocsPageContext(route, corpus, siteConfig)

describe('resolveDocsPageContext', () => {
  assertFixtureStillMatchesSite()

  it('resolves a normal authored docs route to its corpus ref and canonical permalink', () => {
    const value = resolve({
      pathname: '/docs/architecture/packages-concept/',
      activeDocId: 'architecture/packages-concept',
      activeVersionName: 'current'
    })

    expect(value.pathname).toBe('/docs/architecture/packages-concept/')
    expect(value.active).toEqual({
      status: 'document',
      document: {
        ref: 'architecture/packages-concept',
        version: 'current',
        isLast: true,
        title: 'Packages Concept',
        permalink: '/docs/architecture/packages-concept/',
        unlisted: false
      }
    })
    expect(value.diagnostic).toBeUndefined()
  })

  it('treats a direct visit to an authored unlisted document as the current document', () => {
    // #475 keeps unlisted pages out of global search; being unfindable is not
    // the same as being unreadable once a reader is standing on the page.
    const value = resolve({
      pathname: '/docs/updates/PRIVACY-UPDATE/',
      activeDocId: 'updates/PRIVACY-UPDATE',
      activeVersionName: 'current'
    })

    expect(value.active).toMatchObject({
      status: 'document',
      document: {
        ref: 'updates/PRIVACY-UPDATE',
        unlisted: true,
        permalink: '/docs/updates/PRIVACY-UPDATE/'
      }
    })
  })

  it('reports no active document on a non-document route', () => {
    // `/search`, a plain page, or anything else Docusaurus does not route to a doc.
    const value = resolve({ pathname: '/docs/search/' })

    expect(value).toEqual({
      pathname: '/docs/search/',
      active: {
        status: 'no-document',
        reason: 'not_a_document_route',
        message: '"/docs/search/" is not a Docusaurus document route',
        retryable: false
      }
    })
  })

  it('reports no active document on a 404 route, without waiting for the corpus', () => {
    const value = resolve({ pathname: '/docs/nope/' }, { status: 'pending' })

    expect(value.active).toMatchObject({ status: 'no-document', reason: 'not_a_document_route' })
  })

  it('reports a generated category index as a non-authored route, not as drift', () => {
    // Docusaurus puts generated indices in the same `version.docs` list and
    // gives them their slug as an id (leading slash), so they are expected to
    // be absent from the corpus and must not raise a diagnostic.
    const value = resolve({
      pathname: GENERATED_INDEX_PATH,
      activeDocId: GENERATED_INDEX_ID,
      activeVersionName: 'current'
    })

    expect(value.active).toMatchObject({ status: 'no-document', reason: 'generated_index_route' })
    expect(value.diagnostic).toBeUndefined()
  })

  it('reports a retryable pending state while the corpus manifest is still loading', () => {
    const value = resolve(
      {
        pathname: '/docs/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept'
      },
      { status: 'pending' }
    )

    expect(value.active).toMatchObject({
      status: 'no-document',
      reason: 'corpus_pending',
      retryable: true
    })
  })

  it('propagates a corpus fetch failure, including whether it is worth retrying', () => {
    const value = resolve(
      {
        pathname: '/docs/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept'
      },
      {
        status: 'unavailable',
        code: 'manifest_unavailable',
        message: 'manifest request failed with HTTP 503',
        retryable: true
      }
    )

    expect(value.active).toEqual({
      status: 'no-document',
      reason: 'corpus_unavailable',
      message: 'manifest request failed with HTTP 503',
      retryable: true
    })
  })

  it('reports an incompatible corpus distinctly from an unreachable one', () => {
    // #477 must be able to tell "try again shortly" from "this deployment is
    // broken" without parsing the message, and `retryable` alone cannot say so:
    // an unpublished corpus locator is `manifest_unavailable` and not retryable
    // either.
    const value = resolve(
      {
        pathname: '/docs/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept'
      },
      {
        status: 'unavailable',
        code: 'manifest_incompatible',
        message: 'documentation corpus manifest did not match the expected #474 schema',
        retryable: false
      }
    )

    expect(value.active).toEqual({
      status: 'no-document',
      reason: 'corpus_incompatible',
      message: 'documentation corpus manifest did not match the expected #474 schema',
      retryable: false
    })
  })

  it('raises a diagnostic when an authored-looking active id is missing from the corpus', () => {
    const value = resolve({
      pathname: '/docs/ghost/',
      activeDocId: 'ghost',
      activeVersionName: 'current'
    })

    expect(value.active).toMatchObject({
      status: 'no-document',
      reason: 'unknown_active_document',
      retryable: false
    })
    expect(value.diagnostic).toMatchObject({
      code: 'unknown_active_document',
      pathname: '/docs/ghost/',
      ref: 'ghost'
    })
    expect(value.diagnostic?.message).toContain('"ghost"')
  })

  it('resolves a deep link that omits the configured trailing slash', () => {
    const value = resolve({
      pathname: '/docs/architecture/packages-concept',
      activeDocId: 'architecture/packages-concept',
      activeVersionName: 'current'
    })

    expect(value.active).toMatchObject({
      status: 'document',
      document: { permalink: '/docs/architecture/packages-concept/' }
    })
    // The route spelling differs from the canonical permalink; trailing-slash
    // policy is not drift.
    expect(value.diagnostic).toBeUndefined()
  })

  it('resolves the authored landing document at the base-url root', () => {
    // `docs/index.mdx` authors this route (`id: documentation-home`, `slug: /`),
    // so it is a current document like any other. It is also the one path
    // Docusaurus exempts from trailing-slash rewriting.
    const value = resolve({
      pathname: '/docs/',
      activeDocId: 'documentation-home',
      activeVersionName: 'current'
    })

    expect(value.active).toMatchObject({
      status: 'document',
      document: { ref: 'documentation-home', permalink: '/docs/' }
    })
    expect(value.diagnostic).toBeUndefined()
  })

  it('resolves a versioned route against that version, not the canonical one', () => {
    const value = resolve({
      pathname: '/docs/1.0/architecture/packages-concept/',
      activeDocId: 'architecture/packages-concept',
      activeVersionName: '1.0'
    })

    expect(value.active).toMatchObject({
      status: 'document',
      document: {
        ref: 'architecture/packages-concept',
        version: '1.0',
        isLast: false,
        title: 'Packages Concept (1.0)',
        permalink: '/docs/1.0/architecture/packages-concept/'
      }
    })
    expect(value.diagnostic).toBeUndefined()
  })

  it('resolves consistently under a site configured without a trailing slash', () => {
    const documents = [entry({ permalink: '/docs/architecture/packages-concept' })]
    const value = resolve(
      {
        pathname: '/docs/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept',
        activeVersionName: 'current'
      },
      readyCorpus(documents),
      { baseUrl: '/docs/', trailingSlash: false }
    )

    expect(value.active).toMatchObject({
      status: 'document',
      document: { permalink: '/docs/architecture/packages-concept' }
    })
    expect(value.diagnostic).toBeUndefined()
  })

  it('resolves consistently under a different configured base URL', () => {
    const documents = [entry({ versionPath: '/', permalink: '/architecture/packages-concept/' })]
    const value = resolve(
      {
        pathname: '/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept',
        activeVersionName: 'current'
      },
      readyCorpus(documents),
      { baseUrl: '/', trailingSlash: true }
    )

    expect(value.active).toMatchObject({
      status: 'document',
      document: { permalink: '/architecture/packages-concept/' }
    })
    expect(value.diagnostic).toBeUndefined()
  })

  it('still resolves, but diagnoses, a corpus permalink that disagrees with the route', () => {
    // Docusaurus is the authority on which id is active; a manifest that puts
    // that id somewhere else is drift worth shouting about, not a reason to
    // disown the document.
    const documents = [entry({ permalink: '/docs/architecture/old-packages-concept/' })]
    const value = resolve(
      {
        pathname: '/docs/architecture/packages-concept/',
        activeDocId: 'architecture/packages-concept',
        activeVersionName: 'current'
      },
      readyCorpus(documents)
    )

    expect(value.active).toMatchObject({
      status: 'document',
      document: { ref: 'architecture/packages-concept' }
    })
    expect(value.diagnostic).toMatchObject({
      code: 'permalink_mismatch',
      pathname: '/docs/architecture/packages-concept/',
      ref: 'architecture/packages-concept'
    })
  })

  it('pairs the pathname with the identity resolved for that same pathname', () => {
    // The invariant an in-flight SPA navigation must never break: whatever a
    // consumer reads, both halves describe one route.
    const first = resolve({
      pathname: '/docs/architecture/packages-concept/',
      activeDocId: 'architecture/packages-concept',
      activeVersionName: 'current'
    })
    const second = resolve({
      pathname: '/docs/updates/PRIVACY-UPDATE/',
      activeDocId: 'updates/PRIVACY-UPDATE',
      activeVersionName: 'current'
    })

    expect(first.active).toMatchObject({ document: { permalink: first.pathname } })
    expect(second.active).toMatchObject({ document: { permalink: second.pathname } })
  })
})
