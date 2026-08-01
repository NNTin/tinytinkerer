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
import type { DocsPageSnapshotInput } from '../../docs-page/page-snapshot'
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
  overrides: Partial<DocsPageSnapshotInput> = {}
): DocsPageSnapshotInput => ({
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
): DocsPageSnapshotInput => ({
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
    // The provider's `retryCorpus` calls `setCorpus`, so recovery lands on a
    // later task — never synchronously inside the callback. Publishing
    // synchronously in a test would let an implementation that never waited at
    // all still pass, which is exactly how the first version of this suite
    // missed the bug.
    const publishLater = (snapshot: DocsPageSnapshotInput) => {
      setTimeout(() => {
        publishDocsPageSnapshot(snapshot)
      }, 50)
    }

    it('waits for the retry it started instead of answering with the failure that prompted it', async () => {
      installDocumentationCorpus()
      const retryCorpus = vi.fn(() => {
        publishLater(documentSnapshot(CANONICAL))
      })
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_unavailable', {
          pathname: CANONICAL.entry.permalink,
          retryable: true,
          retryCorpus
        })
      )

      const output = await run()

      expect(retryCorpus).toHaveBeenCalledTimes(1)
      expect(output).toMatchObject({ status: 'ok', doc: { ref: CANONICAL.entry.ref } })
    })

    it('does not accept the still-current failure as the retry outcome', async () => {
      installDocumentationCorpus()
      // The provider republishes an equal-looking failure when a retry also
      // fails, so the values cannot discriminate — only the publication can.
      const retryCorpus = vi.fn(() => {
        publishLater(
          noDocumentSnapshot('corpus_unavailable', {
            pathname: CANONICAL.entry.permalink,
            retryable: true
          })
        )
      })
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_unavailable', {
          pathname: CANONICAL.entry.permalink,
          retryable: true,
          retryCorpus
        })
      )

      const output = await run()

      expect(retryCorpus).toHaveBeenCalledTimes(1)
      expect(output).toMatchObject({
        status: 'unavailable',
        reason: 'corpus_unavailable',
        retryable: true
      })
    })

    it('skips the interim pending state the provider publishes before the outcome', async () => {
      installDocumentationCorpus()
      const retryCorpus = vi.fn(() => {
        // Exactly what DocsPageProvider does: back to pending, then the result.
        publishDocsPageSnapshot(
          noDocumentSnapshot('corpus_pending', {
            pathname: CANONICAL.entry.permalink,
            retryable: true
          })
        )
        publishLater(documentSnapshot(CANONICAL))
      })
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_unavailable', {
          pathname: CANONICAL.entry.permalink,
          retryable: true,
          retryCorpus
        })
      )

      expect(await run()).toMatchObject({ status: 'ok', doc: { ref: CANONICAL.entry.ref } })
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

    it('does not retry a load that is merely still in flight', async () => {
      installDocumentationCorpus()
      // `corpus_pending` is retryable in #476's vocabulary, but the provider's
      // gate makes `retryCorpus` a no-op while a load is running — calling it
      // would burn the deadline for nothing.
      const retryCorpus = vi.fn()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_pending', {
          pathname: CANONICAL.entry.permalink,
          retryable: true,
          retryCorpus
        })
      )
      publishLater(documentSnapshot(CANONICAL))

      expect(await run()).toMatchObject({ status: 'ok' })
      expect(retryCorpus).not.toHaveBeenCalled()
    })

    it('spends one deadline in total, not one per wait', async () => {
      installDocumentationCorpus()
      // Pending, then a retryable failure that never recovers: the two waits
      // plus the first-publication wait must still share a single budget, or
      // they would consume most of the runtime's 10s machine tool timeout
      // before the artifact fetch could start.
      vi.useFakeTimers()
      const retryCorpus = vi.fn()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_pending', {
          pathname: CANONICAL.entry.permalink,
          retryable: true,
          retryCorpus
        })
      )

      const started = Date.now()
      let resolvedAt = -1
      // Measured when the call *resolves*, not after the clock is advanced —
      // otherwise the assertion would just be reading back the advance.
      const pending = run().then((value) => {
        resolvedAt = Date.now()
        return value
      })
      await vi.advanceTimersByTimeAsync(20_000)
      await pending

      expect(resolvedAt - started).toBeLessThanOrEqual(4_100)
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

  describe('route pinning', () => {
    it('answers for the route the call was made on, not one navigated to later', async () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(
        noDocumentSnapshot('corpus_pending', {
          pathname: CANONICAL.entry.permalink,
          retryable: true
        })
      )

      const pending = run()
      // The reader moves on while the corpus is still loading. The question was
      // asked about the page they were on, so that is what must be answered.
      setTimeout(() => {
        publishDocsPageSnapshot(documentSnapshot(LANDING))
        publishDocsPageSnapshot(documentSnapshot(CANONICAL))
      }, 20)

      expect(await pending).toMatchObject({
        status: 'ok',
        doc: { ref: CANONICAL.entry.ref }
      })
    })
  })
})

describe('the run pin (issue #480 review, finding 5)', () => {
  afterEach(() => {
    resetDocumentationCorpus()
    resetDocsPageSnapshotForTests()
  })

  /** The tools the runtime builds for one run, as `createRuntime` does. */
  const runScopedReadCurrentDoc = (): Tool<unknown, unknown> => {
    const group = createDocumentationToolGroup()
    const tools = group.createTools?.() ?? group.tools
    const tool = tools.find((candidate) => candidate.id === READ_CURRENT_DOC_TOOL_ID)
    if (!tool) throw new Error('read_current_doc tool is missing from the run-scoped group')
    return tool
  }

  it('answers about the page the run started on, not the one the reader moved to', async () => {
    installDocumentationCorpus()
    // The reader is on the canonical document and hits send.
    publishDocsPageSnapshot(documentSnapshot(CANONICAL))
    const tool = runScopedReadCurrentDoc()

    // …then keeps reading while the model decides, landing somewhere else long
    // before the tool call is actually made.
    publishDocsPageSnapshot(documentSnapshot(LANDING))

    const output = (await tool.execute({})) as ReadCurrentDocOutput
    expect(output).toMatchObject({
      status: 'ok',
      doc: { ref: CANONICAL.entry.ref, permalink: CANONICAL.entry.permalink }
    })
  })

  it('reports no current document when the run started off one, even if the reader lands on one', async () => {
    installDocumentationCorpus()
    // Asked from /search, where there is no current page.
    publishDocsPageSnapshot(noDocumentSnapshot('not_a_document_route'))
    const tool = runScopedReadCurrentDoc()

    publishDocsPageSnapshot(documentSnapshot(CANONICAL))

    const output = (await tool.execute({})) as ReadCurrentDocOutput
    expect(output).toMatchObject({ status: 'not_on_doc_page', pathname: '/docs/search/' })
  })

  it('still waits for a corpus that had not loaded when the run started', async () => {
    // An unsettled pin must NOT short-circuit: a run that began a moment before
    // the manifest arrived would otherwise answer "unavailable" forever.
    publishDocsPageSnapshot(noDocumentSnapshot('corpus_pending', { retryable: true }))
    const tool = runScopedReadCurrentDoc()

    installDocumentationCorpus()
    publishDocsPageSnapshot(documentSnapshot(CANONICAL))

    const output = (await tool.execute({})) as ReadCurrentDocOutput
    expect(output).toMatchObject({ status: 'ok', doc: { ref: CANONICAL.entry.ref } })
  })

  it('leaves the catalogue tools resolving at execution time', async () => {
    // The session-long `tools` array is what the picker lists; it carries no pin,
    // so it keeps #476's behaviour for any consumer that uses it directly.
    installDocumentationCorpus()
    publishDocsPageSnapshot(documentSnapshot(CANONICAL))
    const tool = readCurrentDoc()

    publishDocsPageSnapshot(documentSnapshot(LANDING))

    const output = (await tool.execute({})) as ReadCurrentDocOutput
    expect(output).toMatchObject({ status: 'ok', doc: { ref: LANDING.entry.ref } })
  })

  it('offers the same tool ids either way, which the runtime filters selection against', () => {
    const group = createDocumentationToolGroup()
    expect((group.createTools?.() ?? []).map((tool) => tool.id)).toEqual(
      group.tools.map((tool) => tool.id)
    )
  })
})
