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
 * **The answer is pinned to the ROUTE the run was submitted on, not to a
 * resolution.** A reader who asks about "this page" and then navigates meant the
 * page they asked about. Pinning a resolved snapshot only holds when the corpus
 * had already settled; a run submitted while the manifest was still loading has
 * nothing resolved to hold on to, and re-reading the live snapshot later would
 * silently retarget it (issue #480 re-review, finding 4). So what is captured is
 * the ROUTE — pathname, active document id, version — which is knowable from
 * Docusaurus routing alone, and it is resolved through whatever corpus exists by
 * the time the tool runs, via the snapshot's `resolveRoute`.
 */
import {
  awaitDocsPageSnapshot,
  readDocsPageSnapshot,
  type DocsActiveRoute,
  type DocsPageResolution,
  type DocsPageSnapshot
} from '../docs-page'
import type { SiteUrlConfig } from '../docs-corpus/manifest-store'
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
  | {
      kind: 'document'
      /** The site config the resolving publication carried, for the read that follows. */
      siteConfig: SiteUrlConfig
      document: DocsActiveDocument
    }
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

/**
 * What a run captured about the route it was submitted on.
 *
 * Captured with {@link captureDocsRunPin} at the moment `createRuntime` builds
 * the run's tools, so it describes the page the reader was looking at when they
 * hit send — however long the model then takes to decide to call the tool, and
 * wherever the reader has navigated to in the meantime.
 */
export type DocsRunPin = {
  /** The routing identity the page context had published when the run started. */
  route: DocsActiveRoute
}

/**
 * The route identity as of NOW, for a run that is starting.
 *
 * Deliberately captures the ROUTE and not the resolution: the corpus may not have
 * arrived yet, and "not resolved yet" must never degrade into "resolve it later
 * against wherever the reader ended up".
 *
 * `undefined` when nothing has been published — static rendering, or a provider
 * that is not mounted. It is not read from `window.location`: identity on this
 * site comes from Docusaurus routing and nowhere else (#476, and the mechanical
 * rule in docs-tools/__tests__/source-rules.test.ts), and the URL alone cannot
 * supply the active document id and version a route needs. A run with no pin
 * adopts the first publication instead, which is the earliest route identity that
 * exists at all.
 */
export const captureDocsRunPin = (): DocsRunPin | undefined => {
  const snapshot = readDocsPageSnapshot()
  return snapshot ? { route: snapshot.route } : undefined
}

const isPending = (resolution: DocsPageResolution): boolean =>
  resolution.active.status === 'no-document' && resolution.active.reason === 'corpus_pending'

/**
 * A failure a retry could plausibly change. `corpus_pending` is excluded even
 * though #476 marks it retryable: the provider's `retryCorpus` is gated to
 * *unavailable* states, so calling it while a load is already in flight is a
 * no-op that would burn the remaining budget for nothing.
 */
const isRecoverableFailure = (resolution: DocsPageResolution): boolean =>
  resolution.active.status === 'no-document' &&
  resolution.active.retryable &&
  !isPending(resolution)

const outcomeFor = (
  resolution: DocsPageResolution,
  siteConfig: SiteUrlConfig
): CurrentDocumentOutcome => {
  const { active } = resolution
  if (active.status === 'document') {
    return { kind: 'document', siteConfig, document: active.document }
  }
  if (active.reason === 'not_a_document_route' || active.reason === 'generated_index_route') {
    return { kind: 'not-on-doc-page', pathname: resolution.pathname, message: active.message }
  }
  return {
    kind: 'unavailable',
    pathname: resolution.pathname,
    reason: active.reason,
    message: active.message,
    retryable: active.retryable
  }
}

/**
 * @param pin The route the RUN was submitted on. Omitted, this falls back to the
 * latest publication, which is what a caller with no run context (a direct
 * caller, a test) gets.
 */
export const resolveCurrentDocument = async (pin?: DocsRunPin): Promise<CurrentDocumentOutcome> => {
  const deadline = Date.now() + IDENTITY_RESOLUTION_BUDGET_MS
  const remaining = (): number => Math.max(0, deadline - Date.now())

  let route = pin?.route
  let snapshot = readDocsPageSnapshot()

  if (!route || !snapshot) {
    // Not "no document" — nobody has answered the question yet. That is the case
    // during static rendering, and would be the case if the provider were not
    // mounted; both deserve a short wait rather than a confident wrong answer.
    //
    // The FIRST publication then becomes the pin for the rest of the call, so a
    // run that started before the page context existed is still answered about
    // one route rather than re-reading a moving target at every step.
    const first = await awaitDocsPageSnapshot(() => true, remaining())
    if (!first) {
      return {
        kind: 'unavailable',
        pathname: route?.pathname ?? '',
        reason: 'corpus_pending',
        message:
          'the documentation page context has not published a resolution yet; try again in a moment',
        retryable: true
      }
    }
    snapshot = first
    route ??= first.route
  }

  // Every resolution below is of the PINNED route, through the corpus the
  // resolving publication carried. That is what survives a navigation: the
  // provider republishes for the reader's new route, and this still answers
  // about the old one.
  const pinnedRoute = route

  /**
   * Wait for a publication NEWER than `from` whose corpus has settled for the
   * pinned route, and answer from it — or from `current` if the budget runs out.
   *
   * Both waits below need exactly this, and both need it for the same two
   * reasons. `revision > from` is what stops the still-current state from
   * satisfying the wait immediately (a retry that fails republishes an
   * equal-looking failure, so only the publication identity discriminates), and
   * "not pending" skips the interim `corpus_pending` the provider publishes on
   * its way to an outcome.
   */
  const advance = async (current: DocsPageSnapshot): Promise<DocsPageSnapshot> => {
    const from = current.revision
    const next = await awaitDocsPageSnapshot(
      (candidate) => candidate.revision > from && !isPending(candidate.resolveRoute(pinnedRoute)),
      remaining()
    )
    return next ?? current
  }

  let resolution = snapshot.resolveRoute(pinnedRoute)

  // The corpus may simply not have arrived yet on a freshly loaded page.
  // Waiting is the right answer, and it is what the reader sees a moment later.
  if (isPending(resolution)) {
    snapshot = await advance(snapshot)
    resolution = snapshot.resolveRoute(pinnedRoute)
  }

  if (isRecoverableFailure(resolution)) {
    snapshot.retryCorpus()
    snapshot = await advance(snapshot)
    resolution = snapshot.resolveRoute(pinnedRoute)
  }

  return outcomeFor(resolution, snapshot.siteConfig)
}
