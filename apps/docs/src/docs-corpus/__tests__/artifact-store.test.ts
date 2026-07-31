/**
 * The lazy half of the corpus: caching, coalescing, eviction, and the
 * "nothing fetches a body until a read asks for one" boundary #474 established
 * and #477 must not erode.
 *
 * Content validation and integrity are exercised end-to-end through the read
 * pipeline (docs-tools/__tests__/read-document.test.ts) against this site's real
 * documents; what is left here is the store behaviour a read cannot observe.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadDocumentationArtifact,
  resetDocumentationArtifactStoreForTests
} from '../artifact-store'
import {
  CANONICAL,
  installDocumentationCorpus,
  LANDING,
  OVERSIZED,
  resetDocumentationCorpus,
  UNLISTED
} from '../../docs-tools/__tests__/site-artifact-fixture'

/**
 * The requests that were for a document body, told apart from the manifest one
 * by matching the fixtures' own artifact URLs exactly rather than by sniffing a
 * substring — so an unexpected request cannot be silently counted as a body
 * fetch, or silently ignored.
 */
const ARTIFACT_URLS = new Set(
  [CANONICAL, LANDING, UNLISTED, OVERSIZED].map((fixture) => fixture.entry.artifact)
)

const artifactCalls = (calls: readonly string[]): string[] =>
  calls.filter((url) => ARTIFACT_URLS.has(url))

describe('loadDocumentationArtifact', () => {
  afterEach(() => {
    resetDocumentationCorpus()
  })

  it('fetches a document body once and caches it', async () => {
    const { calls } = installDocumentationCorpus()

    const first = await loadDocumentationArtifact(CANONICAL.entry)
    const second = await loadDocumentationArtifact(CANONICAL.entry)

    expect(first.ok).toBe(true)
    expect(second).toBe(first)
    expect(artifactCalls(calls)).toHaveLength(1)
  })

  it('coalesces concurrent readers onto one fetch', async () => {
    const { calls } = installDocumentationCorpus()

    await Promise.all([
      loadDocumentationArtifact(CANONICAL.entry),
      loadDocumentationArtifact(CANONICAL.entry),
      loadDocumentationArtifact(CANONICAL.entry)
    ])

    expect(artifactCalls(calls)).toHaveLength(1)
  })

  it('keeps documents independent, so one read does not load the corpus', async () => {
    const { calls } = installDocumentationCorpus()

    await loadDocumentationArtifact(CANONICAL.entry)

    expect(artifactCalls(calls)).toEqual([CANONICAL.entry.artifact])
    expect(artifactCalls(calls)).not.toContain(LANDING.entry.artifact)
  })

  it('evicts a retryable failure so the next read can recover', async () => {
    let attempt = 0
    const { calls } = installDocumentationCorpus(undefined, {
      [CANONICAL.entry.artifact]: () => {
        attempt += 1
        return attempt === 1
          ? Promise.resolve(new Response('', { status: 503 }))
          : Promise.resolve(new Response(CANONICAL.bytes, { status: 200 }))
      }
    })

    const failed = await loadDocumentationArtifact(CANONICAL.entry)
    expect(failed).toMatchObject({ ok: false, code: 'document_unavailable', retryable: true })

    const recovered = await loadDocumentationArtifact(CANONICAL.entry)
    expect(recovered.ok).toBe(true)
    expect(artifactCalls(calls)).toHaveLength(2)
  })

  it('keeps a stable failure cached instead of re-fetching what cannot change', async () => {
    const { calls } = installDocumentationCorpus(undefined, {
      [CANONICAL.entry.artifact]: () => Promise.resolve(new Response('not json', { status: 200 }))
    })

    const first = await loadDocumentationArtifact(CANONICAL.entry)
    const second = await loadDocumentationArtifact(CANONICAL.entry)

    expect(first).toMatchObject({ ok: false, retryable: false })
    expect(second).toBe(first)
    expect(artifactCalls(calls)).toHaveLength(1)
  })

  it('names the document and its artifact on a failure', async () => {
    installDocumentationCorpus(undefined, {
      [CANONICAL.entry.artifact]: () => Promise.reject(new Error('offline'))
    })

    expect(await loadDocumentationArtifact(CANONICAL.entry)).toMatchObject({
      ok: false,
      kind: 'documentation_corpus_load_failure',
      ref: CANONICAL.entry.ref,
      artifact: CANONICAL.entry.artifact
    })
  })

  it('rejects an artifact whose section offsets do not fit its Markdown', async () => {
    // A corpus that drifted from its own contract would otherwise slice silently
    // wrong text rather than failing.
    const broken = {
      ...CANONICAL.artifact,
      sections: [{ ...CANONICAL.artifact.sections[0], endOffset: 10_000_000 }]
    }
    installDocumentationCorpus(undefined, {
      [CANONICAL.entry.artifact]: () =>
        Promise.resolve(new Response(`${JSON.stringify(broken)}\n`, { status: 200 }))
    })

    expect(await loadDocumentationArtifact(CANONICAL.entry)).toMatchObject({
      ok: false,
      retryable: false
    })
  })

  it('rejects an artifact whose outline points at the wrong section', async () => {
    // The runtime enforces the *same* semantic invariants the build does, from
    // the one shared validator — so a corpus that could not pass the build
    // cannot be trusted in the browser either. Without this the read would
    // succeed and return text from elsewhere in the document.
    const broken = structuredClone(CANONICAL.artifact)
    broken.outline[0].sectionIndex = 0
    const bytes = `${JSON.stringify(broken)}\n`
    // Republished as a *self-consistent* build would: bytes, artifact hash, and
    // manifest summary all agree, so nothing but the semantic validator can
    // catch it. Tampering without rehashing would only re-test the byte check.
    const entry = {
      ...CANONICAL.entry,
      artifact: `${CANONICAL.entry.artifact}?broken-outline`,
      artifactHash: createHash('sha256').update(bytes).digest('hex')
    }
    installDocumentationCorpus(undefined, {
      [entry.artifact]: () => Promise.resolve(new Response(bytes, { status: 200 }))
    })

    expect(await loadDocumentationArtifact(entry)).toMatchObject({
      ok: false,
      code: 'document_invalid',
      retryable: false
    })
  })

  it('rejects an artifact whose manifest summary no longer matches it', async () => {
    installDocumentationCorpus(undefined, {
      [CANONICAL.entry.artifact]: () =>
        Promise.resolve(new Response(CANONICAL.bytes, { status: 200 }))
    })

    expect(
      await loadDocumentationArtifact({
        ...CANONICAL.entry,
        sectionCount: CANONICAL.entry.sectionCount + 1
      })
    ).toMatchObject({ ok: false, retryable: false })
  })

  it('is not consulted by anything until a read asks for a body', () => {
    // The store holds nothing until called: #474's "initial docs-page loading
    // fetches the manifest at most" is a property of nobody calling this, which
    // this asserts from the store's own side.
    const { calls } = installDocumentationCorpus()
    resetDocumentationArtifactStoreForTests()

    expect(artifactCalls(calls)).toHaveLength(0)
    vi.stubGlobal('fetch', () => Promise.reject(new Error('should not fetch')))
    expect(artifactCalls(calls)).toHaveLength(0)
  })
})
