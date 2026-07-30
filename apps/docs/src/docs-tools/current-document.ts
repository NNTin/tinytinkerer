/**
 * "Which document is the reader on?", answered for a tool rather than a
 * component.
 *
 * This is the half of `read_current_doc` that resolves identity; the read itself
 * is the shared pipeline in read-document.ts. It goes through #476's published
 * resolution (docs-page/page-snapshot.ts) rather than re-deriving anything: the
 * DOM is never read, and neither is the route.
 *
 * The corpus recovery below is the #476 review's finding applied. `retryCorpus()`
 * exists because `@theme/Root` stays mounted for the whole SPA session, so a
 * single failed manifest load would otherwise be permanent while the state still
 * advertised `retryable: true`. A tool that reported that state without invoking
 * the recovery would, in that review's words, "tell the model to retry forever
 * while no retry can change the state" — so this invokes it, waits for the
 * result, and only then answers.
 */
import { awaitDocsPageSnapshot, readDocsPageSnapshot, type DocsPageSnapshot } from '../docs-page'
import type { DocsActiveDocument } from '../docs-page'

/**
 * How long identity resolution may wait on asynchronous corpus state.
 *
 * Comfortably inside the runtime's 10s machine tool timeout (`toolTimeoutMs`),
 * with the remainder left for the artifact fetch that follows. A corpus that
 * never settles costs a late, honest answer rather than a killed tool call.
 */
const CORPUS_SETTLE_TIMEOUT_MS = 4_000

/** The provider publishes on its first commit; this covers the race with it. */
const SNAPSHOT_TIMEOUT_MS = 1_000

export type CurrentDocumentOutcome =
  | { kind: 'document'; snapshot: DocsPageSnapshot; document: DocsActiveDocument }
  | { kind: 'not-on-doc-page'; pathname: string; message: string }
  | {
      kind: 'unavailable'
      pathname: string
      reason:
        | 'corpus_pending'
        | 'corpus_unavailable'
        | 'corpus_incompatible'
        | 'unknown_active_document'
      message: string
      retryable: boolean
    }

const settled = (snapshot: DocsPageSnapshot): boolean =>
  snapshot.active.status === 'document' || snapshot.active.reason !== 'corpus_pending'

export const resolveCurrentDocument = async (): Promise<CurrentDocumentOutcome> => {
  let snapshot = readDocsPageSnapshot()
  if (!snapshot) {
    // Not "no document" — nobody has answered the question yet. That happens
    // during static rendering, and would happen if the provider were not
    // mounted; both are worth a short wait rather than a confident wrong answer.
    snapshot = await awaitDocsPageSnapshot(() => true, SNAPSHOT_TIMEOUT_MS)
    if (!snapshot) {
      return {
        kind: 'unavailable',
        pathname: '',
        reason: 'corpus_pending',
        message:
          'the documentation page context has not published a resolution yet; try again in a moment',
        retryable: true
      }
    }
  }

  // The corpus may simply not have arrived yet on a freshly loaded page. Waiting
  // is the right answer, and it is what the reader would see a moment later.
  if (snapshot.active.status === 'no-document' && snapshot.active.reason === 'corpus_pending') {
    snapshot = (await awaitDocsPageSnapshot(settled, CORPUS_SETTLE_TIMEOUT_MS)) ?? snapshot
  }

  // A retryable corpus failure: actually recover, then wait for the outcome.
  // `retryCorpus` is a no-op unless the corpus is in a retryable failure, so
  // this cannot restart a healthy load or hammer one already in flight.
  if (snapshot.active.status === 'no-document' && snapshot.active.retryable) {
    snapshot.retryCorpus()
    snapshot = (await awaitDocsPageSnapshot(settled, CORPUS_SETTLE_TIMEOUT_MS)) ?? snapshot
  }

  const { pathname, active } = snapshot
  if (active.status === 'document') {
    return { kind: 'document', snapshot, document: active.document }
  }

  if (active.reason === 'not_a_document_route' || active.reason === 'generated_index_route') {
    return { kind: 'not-on-doc-page', pathname, message: active.message }
  }

  return {
    kind: 'unavailable',
    pathname,
    reason: active.reason,
    message: active.message,
    retryable: active.retryable
  }
}
