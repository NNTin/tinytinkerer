import type { ReactNode } from 'react'
import type { ChatEvent } from '@tinytinkerer/contracts'

// One conversation, as the Pixel Agents stage needs to see it (issue #430:
// one office character per conversation). A structural slice of the chat
// store's conversation state — this package stays chat-store-agnostic, the
// host page does the selecting.
export type PixelAgentsConversation = {
  id: string
  title: string
  events: readonly ChatEvent[]
  isRunning: boolean
  // Whether `events` was actually loaded from the repository. The chat store
  // hydrates a conversation's events lazily on first activation, so after a
  // reload every BACKGROUND conversation arrives as an empty, unhydrated
  // array — which must not be mistaken for "never completed a run" (the
  // office would mark every backgrounded agent as awaiting input).
  eventsLoaded: boolean
}

// The office-driven actions the stage dispatches into when the upstream
// webview sends `focusAgent` / `launchAgent` / `closeAgent`.
export type PixelAgentsStageActions = {
  selectConversation: (conversationId: string) => void
  startNewConversation: () => void
  deleteConversation: (conversationId: string) => void
}

export type PixelAgentsStageProps = {
  assistant: ReactNode
  // Display order (most-recent-first, matching the chat store's
  // `conversationOrder`) — the bootstrap and reconciliation logic project this
  // order onto agent numbers, but do not depend on it being stable.
  conversations: readonly PixelAgentsConversation[]
  activeConversationId: string | undefined
  actions: PixelAgentsStageActions
  // Resolves an upstream asset's URL given its path relative to the upstream
  // bundle root (e.g. `'index.html'`, `'tinytinkerer-bootstrap.json'`).
  // Defaults to resolving `upstream/<path>` against `document.baseURI`, which
  // is correct for a stage mounted at a single, fixed app route (issue #430's
  // original host). A host whose page can render at an arbitrary nested route
  // — e.g. the docs site embedding this stage beneath `/docs/**` (issue
  // #452) — cannot rely on that relative resolution and must supply an
  // absolute resolver instead (typically built from its own static-asset base
  // URL, not the current page's path).
  resolveUpstreamUrl?: (path: string) => string
  // IndexedDB database name for the persisted layout/seat/palette workspace
  // record (agent numbers, dock positions, appearance). Defaults to the
  // product's own `tinytinkerer-pixel-agents` database. A host embedding this
  // stage outside the main product on the SAME origin (issue #452) must
  // supply a distinct name so its demo workspace never collides with, or
  // overwrites, the product's own.
  workspaceDatabaseName?: string
  // localStorage key for the dockable panel layout (which panel docks where).
  // Same collision concern as `workspaceDatabaseName` above, for the same
  // same-origin-embedding reason — localStorage is also origin-, not
  // path-scoped.
  dockLayoutStorageKey?: string
  // Reports the current bootstrap failure message, or `null` once bootstrap
  // has succeeded (or on initial mount, before any attempt has resolved). A
  // host that offers its own non-graphical fallback surface (issue #452) uses
  // this to know when the iframe/asset bootstrap failed, without needing to
  // parse or duplicate this stage's own inline error UI.
  onBootstrapError?: (message: string | null) => void
}
