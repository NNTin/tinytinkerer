import { useMemo } from 'react'
import { ChatApp, useChatStore } from '@tinytinkerer/app-browser'
import { PixelAgentsStage, type PixelAgentsConversation } from '@tinytinkerer/pixel-agents'
import { PixelAgentsChatLoading } from './app/loading-screen'

const PixelAgentsPage = (): React.JSX.Element => {
  // Most-recent-first display order and the slices it indexes (issue #430:
  // one office agent per conversation) — read as two separate selectors so a
  // streamed event into one conversation's slice doesn't force every OTHER
  // conversation's memo input to change identity.
  const conversationOrder = useChatStore((state) => state.conversationOrder)
  const conversationsById = useChatStore((state) => state.conversations)
  const activeConversationId = useChatStore((state) => state.conversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewConversation = useChatStore((state) => state.startNewConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)

  // Re-derived only when the order or the slices themselves change (not on
  // every render) — the stage re-renders whenever this array's identity
  // changes, and event streaming already gives each slice a fresh identity on
  // every chunk, so this memo at least avoids ADDING gratuitous churn on top.
  const conversations = useMemo<PixelAgentsConversation[]>(
    () =>
      conversationOrder.flatMap((conversationId) => {
        const slice = conversationsById[conversationId]
        return slice
          ? [
              {
                id: slice.id,
                title: slice.title,
                events: slice.events,
                isRunning: slice.isRunning,
                eventsLoaded: slice.eventsLoaded
              }
            ]
          : []
      }),
    [conversationOrder, conversationsById]
  )

  // Store methods are defined once for the store's lifetime, so this object
  // is effectively stable forever — the stage relies on that to avoid
  // re-running its postMessage-listener/iframe-navigation setup on every
  // render (see pixel-agents-stage.tsx).
  const actions = useMemo(
    () => ({ selectConversation, startNewConversation, deleteConversation }),
    [selectConversation, startNewConversation, deleteConversation]
  )

  return (
    <PixelAgentsStage
      conversations={conversations}
      activeConversationId={activeConversationId}
      actions={actions}
      assistant={
        <ChatApp
          mode="sidebar"
          morphable={false}
          fill
          storageKey="tinytinkerer:pixel-agents-chat-layout:v1"
          LoadingComponent={PixelAgentsChatLoading}
          inspectorPanelSupported
        />
      }
    />
  )
}

export default PixelAgentsPage
