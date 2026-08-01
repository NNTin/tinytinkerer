/**
 * "Which document is the reader on?", answered for a tool rather than a
 * component.
 *
 * This is the half of `read_current_doc` that resolves identity; the read itself
 * is the shared pipeline in read-document.ts. It goes through #476's published
 * resolution (docs-page/page-snapshot.ts) rather than re-deriving anything: the
 * DOM is never read, and neither is the route.
 *
 * Two properties of this module are load-bearing and easy to get wrong.
 *
 * **Recovery is awaited, not merely triggered.** `retryCorpus()` exists because
 * `@theme/Root` stays mounted for the whole SPA session, so a failed manifest
 * load would otherwise be permanent while the state still advertised
 * `retryable: true`. Triggering it and answering immediately is no better: the
 * provider's `setCorpus` is asynchronous React state, so the *current* snapshot
 * is still the failure that prompted the retry. Waiting for a snapshot with a
 * newer `revision` is what makes the difference — the values cannot discriminate
 * (a retry that fails republishes an equal-looking failure), only the
 * publication identity can.
 *
 * **The answer is pinned to the route the call was made on.** A reader who asks
 * about "this page" and then navigates meant the page they asked about, so a
 * later route never retargets an in-flight call.
 */
import { awaitDocsPageSnapshot, readDocsPageSnapshot, type DocsPageSnapshot } from '../docs-page'
import type { DocsActiveDocument } from '../docs-page'

/**
 * One absolute budget for **all** asynchronous waiting in this module, not one
 * per wait.
 *
 * Independent timeouts compose badly: a first-publication wait, a
 * corpus-settling wait, and a retry wait at 1s + 4s + 4s could spend 9s of the
 * runtime's 10s machine tool timeout before the artifact fetch had even
 * started. A single deadline leaves the rest of the budget for the read.
 */
const IDENTITY_RESOLUTION_BUDGET_MS = 4_000

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

const isPending = (snapshot: DocsPageSnapshot): boolean =>
  snapshot.active.status === 'no-document' && snapshot.active.reason === 'corpus_pending'

/**
 * A failure a retry could plausibly change. `corpus_pending` is excluded even
 * though #476 marks it retryable: the provider's `retryCorpus` is gated to
 * *unavailable* states, so calling it while a load is already in flight is a
 * no-op that would burn the remaining budget for nothing.
 */
const isRecoverableFailure = (snapshot: DocsPageSnapshot): boolean =>
  snapshot.active.status === 'no-document' && snapshot.active.retryable && !isPending(snapshot)

/**
 * A settled answer needs no further resolution: the corpus produced it, and no
 * amount of waiting or retrying would change it.
 *
 * Deliberately narrow. `corpus_pending` and the retryable failures are NOT
 * settled — a run that started before the manifest arrived must still be allowed
 * to wait for it rather than answering "unavailable" from a snapshot taken a
 * moment too early.
 */
const isSettled = (snapshot: DocsPageSnapshot): boolean =>
  snapshot.active.status === 'document' ||
  snapshot.active.reason === 'not_a_document_route' ||
  snapshot.active.reason === 'generated_index_route'

/**
 * @param pinned The page context as of when the RUN started (issue #480 review,
 * finding 5). #476 already pinned the answer to the route a tool call was made
 * on; the widget widened the gap that leaves open, because a reader can now
 * submit "summarize this page" and keep reading while the model decides. Without
 * this the eventual `read_current_doc` resolves against wherever they ended up —
 * the run survives the navigation, but its referent silently changes.
 *
 * Only a SETTLED pin short-circuits. An unsettled one falls through to the live
 * path below, which keeps every corpus wait and retry #476 built.
 */
export const resolveCurrentDocument = async (
  pinned?: DocsPageSnapshot
): Promise<CurrentDocumentOutcome> => {
  const deadline = Date.now() + IDENTITY_RESOLUTION_BUDGET_MS
  const remaining = (): number => Math.max(0, deadline - Date.now())

  if (pinned && isSettled(pinned)) {
    return pinned.active.status === 'document'
      ? { kind: 'document', snapshot: pinned, document: pinned.active.document }
      : {
          kind: 'not-on-doc-page',
          pathname: pinned.pathname,
          message: pinned.active.message
        }
  }

  let snapshot = readDocsPageSnapshot()
  if (!snapshot) {
    // Not "no document" — nobody has answered the question yet. That is the case
    // during static rendering, and would be the case if the provider were not
    // mounted; both deserve a short wait rather than a confident wrong answer.
    snapshot = await awaitDocsPageSnapshot(() => true, remaining())
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

  // Pinned for the rest of the call. Every later wait requires the same route,
  // so a reader navigating mid-call gets an answer about the page they asked
  // about rather than the one they happen to have moved to.
  const pathname = snapshot.pathname
  const onPinnedRoute = (candidate: DocsPageSnapshot): boolean => candidate.pathname === pathname

  // The corpus may simply not have arrived yet on a freshly loaded page.
  // Waiting is the right answer, and it is what the reader sees a moment later.
  if (isPending(snapshot)) {
    snapshot =
      (await awaitDocsPageSnapshot(
        (candidate) => onPinnedRoute(candidate) && !isPending(candidate),
        remaining()
      )) ?? snapshot
  }

  if (isRecoverableFailure(snapshot)) {
    const from = snapshot.revision
    snapshot.retryCorpus()
    // A *newer* publication that has settled. Requiring `revision > from` is
    // what stops the still-current failure from satisfying this immediately,
    // and requiring "not pending" skips the interim `corpus_pending` the
    // provider publishes on its way to the outcome.
    snapshot =
      (await awaitDocsPageSnapshot(
        (candidate) =>
          candidate.revision > from && onPinnedRoute(candidate) && !isPending(candidate),
        remaining()
      )) ?? snapshot
  }

  const { active } = snapshot
  if (active.status === 'document') {
    return { kind: 'document', snapshot, document: active.document }
  }

  if (active.reason === 'not_a_document_route' || active.reason === 'generated_index_route') {
    return { kind: 'not-on-doc-page', pathname: snapshot.pathname, message: active.message }
  }

  return {
    kind: 'unavailable',
    pathname: snapshot.pathname,
    reason: active.reason,
    message: active.message,
    retryable: active.retryable
  }
}
