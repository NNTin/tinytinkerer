/**
 * The non-React reader for the #476 documentation page context.
 *
 * `useDocsPageContext()` is a hook, and a `Tool` is a plain object whose
 * `execute` runs from the agent runtime, outside any React tree. #477's
 * `read_current_doc` still has to answer "which document is the reader on?"
 * from the very same resolution the provider publishes — resolving it a second
 * way would be exactly the duplicate source of truth #476 exists to prevent.
 *
 * So the provider publishes each committed resolution here, and non-React
 * consumers read the latest one. Published from a **commit** effect, not during
 * render: a value a discarded render produced must never become the answer a
 * tool gives, and an effect only ever runs for a render React kept.
 *
 * `siteConfig` travels with the snapshot because every documentation operation
 * needs it (the corpus store keys its cache on it, and #475 normalizes search
 * URLs against it) and only the provider is inside Docusaurus' context.
 */
import type { SiteUrlConfig } from '../docs-corpus/manifest-store'
import type { DocsActiveRoute, DocsPageResolution } from './active-document'

export type DocsPageSnapshotInput = DocsPageResolution & {
  /** The site's `baseUrl`/`trailingSlash`, from `useDocusaurusContext()`. */
  siteConfig: SiteUrlConfig
  /** #476's gated corpus recovery. Stable across renders; safe to call unconditionally. */
  retryCorpus: () => void
  /**
   * The UNRESOLVED Docusaurus routing input this publication resolved — pathname
   * plus the active document id and version, before the corpus had any say.
   *
   * Published alongside the resolution because a route's identity is knowable
   * long before the corpus can turn it into a document (issue #480 re-review,
   * finding 4). A run that starts while the manifest is still loading captures
   * this, and {@link DocsPageSnapshotInput.resolveRoute} turns it into an answer
   * once a manifest exists — even if the reader has navigated away by then.
   */
  route: DocsActiveRoute
  /**
   * Resolves ANY route against the corpus as of this publication.
   *
   * The route-independent half of the page context: `active` above answers for
   * the route the reader is on *now*, this answers for a route someone captured
   * earlier. Without it a pinned route could only be re-resolved by waiting for
   * the provider to publish that route again — which never happens once the
   * reader has moved on, so a question asked on A before the manifest arrived
   * could only ever be answered about B.
   */
  resolveRoute: (route: DocsActiveRoute) => DocsPageResolution
}

export type DocsPageSnapshot = DocsPageSnapshotInput & {
  /**
   * Monotonically increasing publication number, assigned here rather than by
   * the provider.
   *
   * A consumer waiting on asynchronous recovery has to distinguish "the state I
   * already saw" from "a state published since I acted". Comparing the values
   * cannot do it — a corpus retry that fails republishes an equal-looking
   * failure — so identity has to come from the publication itself.
   */
  revision: number
}

let current: DocsPageSnapshot | undefined
let revision = 0
const listeners = new Set<(snapshot: DocsPageSnapshot) => void>()

/** Called by `DocsPageProvider` for every committed resolution. */
export const publishDocsPageSnapshot = (snapshot: DocsPageSnapshotInput): void => {
  revision += 1
  current = { ...snapshot, revision }
  for (const listener of Array.from(listeners)) listener(current)
}

/**
 * The latest committed resolution, or `undefined` before the provider's first
 * commit — during static rendering, or if `DocsPageProvider` is not mounted at
 * all. Callers must treat `undefined` as "not known yet" rather than "no
 * document": the two are very different answers to give a reader.
 */
export const readDocsPageSnapshot = (): DocsPageSnapshot | undefined => current

export const subscribeDocsPageSnapshot = (
  listener: (snapshot: DocsPageSnapshot) => void
): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Resolves with the first snapshot satisfying `predicate`, or `undefined` if
 * none arrives within `timeoutMs`.
 *
 * This is what makes #476's `retryCorpus()` usable from a tool. Recovery is
 * asynchronous state on a provider the tool cannot re-render, so a tool that
 * kicked off a retry and answered immediately would report the same failure it
 * just tried to fix. The wait is deliberately bounded well below the runtime's
 * machine tool timeout, so a corpus that never settles costs a late answer
 * rather than a killed tool call.
 *
 * The current snapshot is checked first, so an already-satisfied condition
 * resolves without waiting for another publish that may never come.
 */
export const awaitDocsPageSnapshot = (
  predicate: (snapshot: DocsPageSnapshot) => boolean,
  timeoutMs: number
): Promise<DocsPageSnapshot | undefined> => {
  if (current && predicate(current)) return Promise.resolve(current)

  return new Promise((resolve) => {
    let settled = false
    const finish = (snapshot: DocsPageSnapshot | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(snapshot)
    }
    const timer = setTimeout(() => {
      finish(undefined)
    }, timeoutMs)
    const unsubscribe = subscribeDocsPageSnapshot((snapshot) => {
      if (predicate(snapshot)) finish(snapshot)
    })
  })
}

/** Test-only: clears the published snapshot, the revision counter, and every subscriber. */
export const resetDocsPageSnapshotForTests = (): void => {
  current = undefined
  revision = 0
  listeners.clear()
}
