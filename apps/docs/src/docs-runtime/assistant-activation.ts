/**
 * When the assistant runtime starts, and what it is doing (issue #479).
 *
 * The runtime host is mounted from `@theme/Root` on every documentation route,
 * but the product runtime itself must NOT be downloaded by every documentation
 * page — `scripts/check-docs-performance-budget.mjs` enforces exactly that shape
 * for the live-lab chunk, and the assistant is held to it too. So the host stays
 * light until something asks for the runtime, and this module is the ask.
 *
 * Light on purpose: no `@tinytinkerer/app-browser` import, so a launcher (#480)
 * or a sidebar page (#472) can call `activate()` — and render a state for it —
 * without dragging the runtime into its own chunk.
 *
 * Module-level rather than React state because the answer must outlive every
 * route: Docusaurus keeps `@theme/Root` mounted across SPA navigation, and an
 * assistant that restarted on each route change would be a different assistant.
 */
import { useSyncExternalStore } from 'react'
import { createSubscribable } from './subscribable'

export type DocsAssistantRuntimeStatus =
  /** Nothing has asked for the runtime; no chunk has been fetched. */
  | 'idle'
  /** Requested: the chunk is loading, or the session is bootstrapping. */
  | 'starting'
  /** The session is live and its surfaces are mounted. */
  | 'ready'
  /** The chunk or the bootstrap failed. `activate()` again to retry. */
  | 'error'

let status: DocsAssistantRuntimeStatus = 'idle'
const { subscribe, emit } = createSubscribable()

const readStatus = (): DocsAssistantRuntimeStatus => status

// Static rendering and the hydration pass have no runtime and no way to start
// one, so they always read `idle` — the server and the first client render
// agree, and activation happens strictly afterwards.
const readServerStatus = (): DocsAssistantRuntimeStatus => 'idle'

/**
 * Ask for the assistant runtime. Idempotent, and safe to call from an event
 * handler on any route.
 *
 * Retries from `error`, which is what makes a failed chunk load recoverable
 * rather than a dead assistant for the rest of the session — a state that
 * advertises a retry must actually have one (the lesson #476 recorded).
 */
export const requestDocsAssistantRuntime = (): void => {
  if (status === 'starting' || status === 'ready') return
  status = 'starting'
  emit()
}

/** Published by the runtime host as its own boot progresses. */
export const publishDocsAssistantRuntimeStatus = (next: DocsAssistantRuntimeStatus): void => {
  if (status === next) return
  status = next
  emit()
}

/** The current status, for a non-React caller (and for tests). */
export const readDocsAssistantRuntimeStatus = (): DocsAssistantRuntimeStatus => status

export const useDocsAssistantRuntimeStatus = (): DocsAssistantRuntimeStatus =>
  useSyncExternalStore(subscribe, readStatus, readServerStatus)

/**
 * The activation surface consumers use: `status` to render a launcher state,
 * `activate` to start the runtime.
 */
export const useDocsAssistantRuntime = (): {
  status: DocsAssistantRuntimeStatus
  activate: () => void
} => ({
  status: useDocsAssistantRuntimeStatus(),
  activate: requestDocsAssistantRuntime
})
