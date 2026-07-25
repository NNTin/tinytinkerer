// Only ever reached once a <LiveLab> boundary has mounted client-side AND its
// <LiveSessionGate> has decided the docs session is ready/running (see
// PixelAgentsLab.tsx's lazy import) — so importing the product runtime and its
// stylesheets here, at module scope, never affects a page that doesn't render
// a <PixelAgentsLab>, and never runs during static rendering.
import { useCallback, useMemo, useState } from 'react'
import { ChatApp, useChatStore } from '@tinytinkerer/app-browser'
import {
  conversationActivityStatus,
  PixelAgentsStage,
  type PixelAgentsConversation
} from '@tinytinkerer/pixel-agents'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/pixel-agents/styles.css'
import { ConversationSwitcher, type ConversationSwitcherItem } from './ConversationSwitcher'
import { usePixelAgentsCapability } from './capability'
import {
  DOCS_PIXEL_AGENTS_CHAT_STORAGE_KEY,
  DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY,
  DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE
} from './constants'
import { PixelAgentsLabChatLoading } from './loading-screen'
import { useResolveUpstreamUrl } from './upstream-url'

// issue #452: the demo conversation list is the docs session's own isolated
// chat store (see live-lab/client-runtime.tsx — a completely separate
// IndexedDB database from the main product's), NOT a docs-only data model.
// Deleting/creating/renaming here never touches a visitor's real conversations.
export const PixelAgentsLabContent = (): React.JSX.Element => {
  const resolveUpstreamUrl = useResolveUpstreamUrl()
  const [pixelAgentsFailed, setPixelAgentsFailed] = useState(false)
  const canRunPixelAgents = usePixelAgentsCapability(pixelAgentsFailed)

  // Two separate selectors (matching apps/pixel-agents/src/pixel-agents-page.tsx)
  // so a streamed event into one conversation's slice doesn't force every
  // OTHER conversation's memo input to change identity.
  const conversationOrder = useChatStore((state) => state.conversationOrder)
  const conversationsById = useChatStore((state) => state.conversations)
  const activeConversationId = useChatStore((state) => state.conversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewConversation = useChatStore((state) => state.startNewConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)

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

  // The SAME ChatEvent-derived projection PixelAgentsStage itself uses (see
  // @tinytinkerer/pixel-agents's activity.ts) — the textual switcher reads no
  // separate, docs-only event protocol.
  const switcherItems = useMemo<ConversationSwitcherItem[]>(
    () =>
      conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        status: conversationActivityStatus(conversation)
      })),
    [conversations]
  )

  const actions = useMemo(
    () => ({ selectConversation, startNewConversation, deleteConversation }),
    [selectConversation, startNewConversation, deleteConversation]
  )

  const handleBootstrapError = useCallback((message: string | null) => {
    setPixelAgentsFailed(message !== null)
  }, [])

  const assistant = (
    <ChatApp
      mode="sidebar"
      morphable={false}
      fill
      storageKey={DOCS_PIXEL_AGENTS_CHAT_STORAGE_KEY}
      LoadingComponent={PixelAgentsLabChatLoading}
      inspectorPanelSupported
    />
  )

  return (
    <div className="pixel-agents-lab">
      {/* Always present (issue #452 acceptance: keyboard/screen-reader users
          manage every conversation through this surface regardless of
          whether the graphical office below is offered), and unaffected by a
          Pixel Agents asset/bridge failure — it talks to the chat store
          directly, never through the office's postMessage bridge. */}
      <ConversationSwitcher
        conversations={switcherItems}
        activeConversationId={activeConversationId}
        onSelect={(conversationId) => void selectConversation(conversationId)}
        onCreate={() => void startNewConversation()}
        onDelete={(conversationId) => void deleteConversation(conversationId)}
      />
      {canRunPixelAgents ? (
        <PixelAgentsStage
          conversations={conversations}
          activeConversationId={activeConversationId}
          actions={actions}
          assistant={assistant}
          resolveUpstreamUrl={resolveUpstreamUrl}
          workspaceDatabaseName={DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE}
          dockLayoutStorageKey={DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY}
          onBootstrapError={handleBootstrapError}
        />
      ) : (
        <div className="pixel-agents-lab__fallback">{assistant}</div>
      )}
    </div>
  )
}
