import type { ContentDocument } from '@tinytinkerer/contracts'
import { useCallback } from 'react'
import { useOptionalBrowserApp } from './app'
import type { AppToolResultRecord } from './app-assistant-policy'
import type { TurnActivityItem } from '@tinytinkerer/app-core'

/**
 * The successful tool results of ONE turn, in the order they ran (issue #478).
 *
 * Derived from the turn's own activity items rather than from the conversation's
 * whole event log: an answer's citations are authorized by the results *that
 * answer* was built from, and the finalizer at the runtime boundary is scoped to
 * the run for exactly the same reason. Reading a wider scope here would let a
 * link authorized three turns ago stay clickable in an answer that never fetched
 * it — and would disagree with the finalized source the moment the turn settled.
 *
 * Activity items are projected from the persisted `agent.tool.*` events, so this
 * covers a live run and a reload with no separate rehydrate path. A `completed`
 * item is a successful result by construction; `started`/`failed` are skipped,
 * which is what keeps a failed result from ever authorizing a link.
 */
export const toolResultsFromActivity = (
  items: readonly TurnActivityItem[]
): readonly AppToolResultRecord[] =>
  items.reduce<AppToolResultRecord[]>(
    (records, item) =>
      item.kind === 'tool' && item.status === 'completed'
        ? [...records, { toolId: item.toolId, output: item.output }]
        : records,
    []
  )

/**
 * The app's render-time content policy, or a pass-through when it has none.
 *
 * Tolerates rendering outside a mounted BrowserApp (component tests, the docs
 * content playground): the document is then returned untouched, matching a host
 * that wires no policy at all.
 */
export const useSanitizeRenderedContent = (): ((
  document: ContentDocument,
  results: readonly AppToolResultRecord[]
) => ContentDocument) => {
  const sanitize = useOptionalBrowserApp()?.appAssistantPolicy?.sanitizeRenderedContent
  return useCallback(
    (document: ContentDocument, results: readonly AppToolResultRecord[]) =>
      sanitize ? sanitize({ document, results }) : document,
    [sanitize]
  )
}
