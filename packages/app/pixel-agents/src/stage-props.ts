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
}
