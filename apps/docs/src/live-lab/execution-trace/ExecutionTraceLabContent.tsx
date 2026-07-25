// Only ever reached once a <LiveLab> boundary has mounted client-side AND its
// <LiveSessionGate> has decided the docs session is ready/running (see
// ExecutionTraceLab.tsx's lazy import) — so importing the product runtime and
// its stylesheets here, at module scope, never affects a page that doesn't
// render an <ExecutionTraceLab>, and never runs during static rendering.
import { useCallback, useMemo, useState } from 'react'
import { useChatStore } from '@tinytinkerer/app-browser'
import {
  conversationActivityStatus,
  PixelAgentsStage,
  type PixelAgentsConversation
} from '@tinytinkerer/pixel-agents'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/pixel-agents/styles.css'
import {
  ConversationSwitcher,
  type ConversationSwitcherItem
} from '../pixel-agents/ConversationSwitcher'
import { usePixelAgentsCapability } from '../pixel-agents/capability'
import {
  DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY,
  DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE
} from '../pixel-agents/constants'
import { useResolveUpstreamUrl } from '../pixel-agents/upstream-url'
import { ExecutionTracePanel } from './ExecutionTracePanel'

// Reuses the SAME demo workspace database/dock-layout keys as PixelAgentsLab
// (issue #452): both labs project the SAME underlying docs-isolated chat
// store onto the SAME Pixel Agents office, so a visitor's demo conversations
// stay consistent across whichever lab page they land on, rather than each
// lab owning a competing copy of "the" Pixel Agents workspace.
export const ExecutionTraceLabContent = (): React.JSX.Element => {
  const resolveUpstreamUrl = useResolveUpstreamUrl()
  const [pixelAgentsFailed, setPixelAgentsFailed] = useState(false)
  const canRunPixelAgents = usePixelAgentsCapability(pixelAgentsFailed)

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

  // The SAME ChatEvent-derived projection PixelAgentsStage itself uses — the
  // textual switcher (and, per-run, the trace panel's live badge) reads no
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

  const assistant = <ExecutionTracePanel />

  return (
    <div className="execution-trace-lab">
      {/* Always present (mirrors PixelAgentsLab's accessible fallback,
          issue #452): keyboard/screen-reader users manage every demo
          conversation through this surface regardless of whether the
          graphical office below is offered, and the trace panel above always
          describes whichever conversation is active here. */}
      <ConversationSwitcher
        conversations={switcherItems}
        activeConversationId={activeConversationId}
        onSelect={(conversationId) => void selectConversation(conversationId)}
        onCreate={() => void startNewConversation()}
        onDelete={(conversationId) => void deleteConversation(conversationId)}
      />
      {canRunPixelAgents ? (
        // See PixelAgentsLabContent.tsx's identical wrapper for why this explicit
        // height is required: @tinytinkerer/pixel-agents's root is `height: 100%`
        // all the way down, which collapses to zero without a definite-height
        // ancestor (a Docusaurus MDX article provides none on its own).
        <div className="execution-trace-lab__stage">
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
        </div>
      ) : (
        <div className="execution-trace-lab__fallback">{assistant}</div>
      )}
    </div>
  )
}
