/**
 * `read_current_doc`, driven through #476's published page resolution.
 *
 * Two behaviours here are direct consequences of the #476 review and are the
 * reason this suite exists rather than folding into read-document.test.ts:
 *
 * - `/docs/` is an authored document on this site (`documentation-home`), so
 *   answering `not_on_doc_page` there would fail #471's opening use case on the
 *   site's most-visited page;
 * - a retryable corpus failure must actually invoke `retryCorpus()` and wait for
 *   the outcome, rather than reporting "retryable" to a model that has no way to
 *   act on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tool } from '@tinytinkerer/app-browser'
import {
  publishDocsPageSnapshot,
  resetDocsPageSnapshotForTests
} from '../../docs-page/page-snapshot'
import type { DocsPageSnapshot } from '../../docs-page/page-snapshot'
import type { DocsNoActiveDocumentReason } from '../../docs-page'
import { createDocumentationToolGroup, READ_CURRENT_DOC_TOOL_ID } from '../index'
import { readCurrentDocOutputSchema, type ReadCurrentDocOutput } from '../schemas'
import {
  CANONICAL,
  installDocumentationCorpus,
  LANDING,
  OVERSIZED,
  resetDocumentationCorpus,
  SITE_CONFIG
} from './site-artifact-fixture'

const readCurrentDoc = (): Tool<unknown, unknown> => {
  const tool = createDocumentationToolGroup().tools.find(
    (candidate) => candidate.id === READ_CURRENT_DOC_TOOL_ID
  )
  if (!tool) throw new Error('read_current_doc tool is missing from the Documentation group')
  return tool
}

const run = async (input: Record<string, unknown> = {}): Promise<ReadCurrentDocOutput> => {
  const output = await readCurrentDoc().execute(input)
  const parsed = readCurrentDocOutputSchema.safeParse(output)
  expect(parsed.error?.message ?? 'ok').toBe('ok')
  return output as ReadCurrentDocOutput
}

const documentSnapshot = (
  fixture: typeof CANONICAL,
  overrides: Partial<DocsPageSnapshot> = {}
): DocsPageSnapshot => ({
  pathname: fixture.entry.permalink,
  siteConfig: SITE_CONFIG,
  retryCorpus: () => {},
  active: {
    status: 'document',
    document: {
      ref: fixture.entry.ref,
      version: fixture.entry.version,
      isLast: fixture.entry.isLast,
      title: fixture.entry.title,
      permalink: fixture.entry.permalink,
      unlisted: fixture.entry.unlisted
    }
  },
  ...overrides
})

const noDocumentSnapshot = (
  reason: DocsNoActiveDocumentReason,
  options: { pathname?: string; retryable?: boolean; retryCorpus?: () => void } = {}
): DocsPageSnapshot => ({
  pathname: options.pathname ?? '/docs/search/',
  siteConfig: SITE_CONFIG,
  retryCorpus: options.retryCorpus ?? (() => {}),
  active: {
    status: 'no-document',
    reason,
    message: `no current document: ${reason}`,
    retryable: options.retryable ?? false
  }
})

describe('read_current_doc', () => {
  afterEach(() => {
    resetDocumentationCorpus()
    resetDocsPageSnapshotForTests()
    vi.useRealTimers()
  })

  describe('on an authored document route', () => {
    it('reads the Markdown corpus for the document #476 reports', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(documentSnapshot(CANONICAL))

      const output = await run()
      expect(output).toMatchObject({
        status: 'ok',
        doc: { ref: CANONICAL.entry.ref, permalink: CANONICAL.entry.permalink }
      })
      if (output.status !== 'ok') return
      // Authored source Markdown, not anything derived from a rendered page.
      expect(output.sections[0]?.markdown).toBe(CANONICAL.artifact.markdown)
    })

    it('treats the docs landing route as a current document', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(documentSnapshot(LANDING))

      const output = await run()
      expect(output).toMatchObject({
        status: 'ok',
        doc: { ref: 'documentation-home', permalink: '/docs/' }
      })
    })

    it('reads a named section of the current page', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(documentSnapshot(OVERSIZED))
      const anchor = OVERSIZED.artifact.outline[0]?.anchor

      const output = await run({ anchor })
      expect(output).toMatchObject({ status: 'ok', selection: 'section' })
      if (output.status !== 'ok') return
      expect(output.sections[0]?.anchor).toBe(anchor)
    })

    it('reads the version the route belongs to, not whatever the ref resolves to', async () => {
      // The canonical entry and a historical one share a ref; an unqualified
      // lookup would silently return the canonical version's content.
      const historical = {
        ...CANONICAL,
        entry: {
          ...CANONICAL.entry,
          version: '1.0',
          versionPath: '/docs/1.0/',
          isLast: false,
          permalink: '/docs/1.0/architecture/packages-concept/',
          artifact: `${CANONICAL.entry.artifact}?v=1.0`
        },
        artifact: { ...CANONICAL.artifact, version: '1.0' }
      }
      historical.bytes = `${JSON.stringify(historical.artifact)}\n`
      const { createHash } = await import('node:crypto')
      historical.entry.artifactHash = createHash('sha256').update(historical.bytes).digest('hex')

      installDocumentationCorpus([CANONICAL, historical])
      publishDocsPageSnapshot(
        documentSnapshot(CANONICAL, {
          pathname: historical.entry.permalink,
          active: {
            status: 'document',
            document: {
              ref: historical.entry.ref,
              version: '1.0',
              isLast: false,
              title: historical.entry.title,
              permalink: historical.entry.permalink,
              unlisted: false
            }
          }
        })
      )

      const output = await run()
      expect(output).toMatchObject({
        status: 'ok',
        doc: { version: '1.0', isLast: false, permalink: historical.entry.permalink }
      })
    })
  })

  describe('on a route with no authored document', () => {
    it.each<DocsNoActiveDocumentReason>(['not_a_document_route', 'generated_index_route'])(
      'reports not_on_doc_page for %s',
      async (reason) => {
        installDocumentationCorpus()
        publishDocsPageSnapshot(noDocumentSnapshot(reason, { pathname: '/docs/search/' }))

        const output = await run()
        expect(output).toMatchObject({ status: 'not_on_doc_page', pathname: '/docs/search/' })
      }
    )

    it('does not report not_on_doc_page when the corpus is what failed', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_incompatible', { pathname: '/docs/architecture/' })
      )

      const output = await run()
      expect(output).toMatchObject({
        status: 'unavailable',
        reason: 'corpus_incompatible',
        retryable: false,
        pathname: '/docs/architecture/'
      })
    })

    it('reports an active id the corpus has never heard of as unavailable', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(noDocumentSnapshot('unknown_active_document'))

      const output = await run()
      expect(output).toMatchObject({ status: 'unavailable', reason: 'unknown_active_document' })
    })
  })

  describe('corpus recovery', () => {
    it('invokes retryCorpus and answers from the recovered state', async () => {
      installDocumentationCorpus()
      const retryCorpus = vi.fn(() => {
        // What DocsPageProvider does on a successful retry.
        publishDocsPageSnapshot(documentSnapshot(CANONICAL))
      })
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_unavailable', { retryable: true, retryCorpus })
      )

      const output = await run()

      expect(retryCorpus).toHaveBeenCalledTimes(1)
      expect(output).toMatchObject({ status: 'ok', doc: { ref: CANONICAL.entry.ref } })
    })

    it('does not invoke retryCorpus for a failure no retry can fix', async () => {
      installDocumentationCorpus()
      const retryCorpus = vi.fn()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_incompatible', { retryable: false, retryCorpus })
      )

      await run()
      expect(retryCorpus).not.toHaveBeenCalled()
    })

    it('reports honestly when the retry it started does not recover', async () => {
      installDocumentationCorpus()
      vi.useFakeTimers()
      const retryCorpus = vi.fn()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_unavailable', { retryable: true, retryCorpus })
      )

      const pending = run()
      await vi.advanceTimersByTimeAsync(10_000)
      const output = await pending

      expect(retryCorpus).toHaveBeenCalledTimes(1)
      expect(output).toMatchObject({
        status: 'unavailable',
        reason: 'corpus_unavailable',
        retryable: true
      })
    })

    it('waits for a corpus still loading instead of answering "no document"', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(noDocumentSnapshot('corpus_pending', { retryable: true }))

      const pending = run()
      // The provider settles a moment later, exactly as it does on a fresh page.
      publishDocsPageSnapshot(documentSnapshot(CANONICAL))

      expect(await pending).toMatchObject({ status: 'ok', doc: { ref: CANONICAL.entry.ref } })
    })

    it('reports pending rather than "no document" when nothing has published yet', async () => {
      installDocumentationCorpus()
      vi.useFakeTimers()

      const pending = run()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(await pending).toMatchObject({
        status: 'unavailable',
        reason: 'corpus_pending',
        retryable: true
      })
    })
  })
})
