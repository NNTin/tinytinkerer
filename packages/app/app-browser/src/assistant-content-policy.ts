import type { ContentDocument } from '@tinytinkerer/contracts'
import { useMemo } from 'react'
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
 * which is what keeps a failed result from ever authorizing a link. The host's
 * `source` attribution rides along on the same events, so a policy gating trust
 * on provenance reads it identically live and after a reload.
 */
export const toolResultsFromActivity = (
  items: readonly TurnActivityItem[]
): readonly AppToolResultRecord[] =>
  items.reduce<AppToolResultRecord[]>(
    (records, item) =>
      item.kind === 'tool' && item.status === 'completed'
        ? [
            ...records,
            {
              toolId: item.toolId,
              output: item.output,
              ...(item.source ? { source: item.source } : {})
            }
          ]
        : records,
    []
  )

const passThrough = (document: ContentDocument): ContentDocument => document

/**
 * The app's render-time content sanitizer, compiled once per turn's results.
 *
 * The memo is the point: `results` is stable while a turn only streams content
 * (see `reconcileTurns`, which hands back an unchanged activity by reference),
 * so a policy's preparation — schema validation, ledger construction — happens
 * once per tool completion instead of once per chunk.
 *
 * Tolerates rendering outside a mounted BrowserApp (component tests, the docs
 * content playground): the document is then returned untouched, matching a host
 * that wires no policy at all.
 */
export const useRenderedContentSanitizer = (
  results: readonly AppToolResultRecord[]
): ((document: ContentDocument) => ContentDocument) => {
  const prepare = useOptionalBrowserApp()?.appAssistantPolicy?.prepareRenderedContent
  return useMemo(() => (prepare ? prepare({ results }) : passThrough), [prepare, results])
}
