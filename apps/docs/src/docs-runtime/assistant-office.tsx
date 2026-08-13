/**
 * The Pixel Agents Office, as the documentation assistant's conversation-
 * management surface (issue #472).
 *
 * **Why this exists at all.** Since `0db1466` the office is the product's *sole*
 * conversation-management surface — `ChatApp` has no switcher, on any shell. So
 * without this the documentation assistant has exactly one conversation and no
 * way to start, leave, or end it. This is not decoration.
 *
 * **How it reaches the session.** It is registered as a `portal` surface
 * (assistant-runtime-client.tsx), so the host renders it inside the assistant's
 * provider and portals it into whatever DOM target the sidebar slot registered.
 * That makes it a logical descendant of the one assistant `BrowserApp` — one
 * conversation repository, one query client, one plugin subset, one pre-send
 * disclosure gate — while physically living in the Docusaurus sidebar, which no
 * React descendant of the provider could.
 *
 * It talks to `useDocsAssistantSession()` and nothing else: no `useChatStore`,
 * no storage namespace, no second `BrowserApp`. The live labs read the store
 * directly (live-lab/pixel-agents/PixelAgentsLabContent.tsx) because they own
 * their session; this one does not.
 *
 * Runtime-only module: it imports the office package and the product runtime,
 * and is reachable exclusively through the assistant runtime chunk's dynamic
 * import (asserted by docs-runtime/__tests__/static-safety.test.ts).
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  conversationActivityStatus,
  PixelAgentsStage,
  type PixelAgentsConversation
} from '@tinytinkerer/pixel-agents'
import '@tinytinkerer/pixel-agents/styles.css'
import {
  ConversationSwitcher,
  useResolveUpstreamUrl,
  usePixelAgentsCapability,
  type ConversationSwitcherItem
} from '../pixel-agents'
import { DOCS_ASSISTANT_OFFICE_WORKSPACE_DATABASE } from './assistant-constants'
import { useDocsAssistantSession } from './session'

const BLOCK = 'docs-assistant-office'

export const DocsAssistantOffice = (): ReactNode => {
  const {
    conversations: sessionConversations,
    activeConversationId,
    selectConversation,
    startNewConversation,
    deleteConversation
  } = useDocsAssistantSession()
  const resolveUpstreamUrl = useResolveUpstreamUrl()
  const [officeFailed, setOfficeFailed] = useState(false)
  const canRunOffice = usePixelAgentsCapability(officeFailed)

  // The session's list is already ordered and already carries the events and
  // hydration flag the office projection needs, so this is a rename rather than
  // a second derivation of "what conversations are there" (issue #472 extended
  // `DocsAssistantConversation` for exactly this consumer).
  const conversations = useMemo<PixelAgentsConversation[]>(
    () =>
      sessionConversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        events: conversation.events,
        isRunning: conversation.isRunning,
        eventsLoaded: conversation.eventsLoaded
      })),
    [sessionConversations]
  )

  // The SAME ChatEvent-derived projection PixelAgentsStage itself uses, so the
  // textual list below cannot disagree with the characters above it.
  const switcherItems = useMemo<ConversationSwitcherItem[]>(
    () =>
      conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        status: conversationActivityStatus(conversation)
      })),
    [conversations]
  )

  // The stage's actions are synchronous by contract; the session's return
  // promises. Fire-and-forget is correct here — every one of them lands in the
  // store, which is what re-renders this surface.
  const actions = useMemo(
    () => ({
      selectConversation: (conversationId: string) => void selectConversation(conversationId),
      startNewConversation: () => void startNewConversation(),
      deleteConversation: (conversationId: string) => void deleteConversation(conversationId)
    }),
    [selectConversation, startNewConversation, deleteConversation]
  )

  const handleBootstrapError = useCallback((message: string | null) => {
    setOfficeFailed(message !== null)
  }, [])

  const switcher = (
    <ConversationSwitcher
      block={BLOCK}
      label="Assistant conversations"
      // Distinct from the live labs' "New conversation": a lab page carries
      // both surfaces at once, over two different sessions, and neither a
      // screen-reader user nor a test should have to guess which is which.
      createLabel="New assistant conversation"
      conversations={switcherItems}
      activeConversationId={activeConversationId}
      onSelect={(conversationId) => void selectConversation(conversationId)}
      onCreate={() => void startNewConversation()}
      onDelete={(conversationId) => void deleteConversation(conversationId)}
    />
  )

  if (!canRunOffice) {
    // Narrow viewport, reduced motion, or the frame failed to boot. The reader
    // still gets full conversation management, just without the room.
    return <div className={`${BLOCK}__fallback`}>{switcher}</div>
  }

  return (
    <>
      <div className={`${BLOCK}__stage`}>
        <PixelAgentsStage
          conversations={conversations}
          activeConversationId={activeConversationId}
          actions={actions}
          // No `assistant`: the chat is #480's widget, elsewhere on the page,
          // and omitting it is what selects the office-only layout. Compact
          // chrome because this is a ~300px column — see the `chrome` prop in
          // @tinytinkerer/pixel-agents' stage-props.ts for what it switches.
          chrome="compact"
          resolveUpstreamUrl={resolveUpstreamUrl}
          workspaceDatabaseName={DOCS_ASSISTANT_OFFICE_WORKSPACE_DATABASE}
          onBootstrapError={handleBootstrapError}
        />
      </div>
      {/* Collapsed by default while the office is showing: the characters are
          the primary surface and the sidebar has no room to spare. Still a
          real, focusable control, so a keyboard or screen-reader user is one
          Enter away from managing every conversation — the canvas offers them
          nothing. */}
      <details className={`${BLOCK}__conversations`}>
        <summary>Conversations ({switcherItems.length})</summary>
        {switcher}
      </details>
    </>
  )
}
