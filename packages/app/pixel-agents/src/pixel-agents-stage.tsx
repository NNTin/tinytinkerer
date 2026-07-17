import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DockablePanelLayout, useLiveChatActivity } from '@tinytinkerer/app-shell'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForChatEvent } from './activity'
import {
  PIXEL_AGENTS_BRIDGE_CHANNEL,
  createPixelBootstrapMessages,
  parsePixelAgentsBootstrap,
  parsePixelClientEnvelope,
  type PixelAgentMeta,
  type PixelBootstrapAgent,
  type PixelServerMessage
} from './protocol'
import type { PixelAgentsConversation, PixelAgentsStageProps } from './stage-props'
import {
  adoptLegacySeat,
  loadPixelAgentsWorkspace,
  resolveAgentNumber,
  retireAgentNumber,
  savePixelAgentsWorkspace,
  type PixelAgentsWorkspaceRecord
} from './workspace-db'

const upstreamUrl = (path: string): string => new URL(`upstream/${path}`, document.baseURI).href

const hasCompletedRun = (events: readonly ChatEvent[]): boolean =>
  events.some((event) => event.type === 'agent.run.completed')

// Whether an idle agent should show the office's awaiting-input state. An
// UNHYDRATED conversation (events not yet loaded — after a reload, every
// background conversation) must read as NOT awaiting: its empty events array
// says nothing about whether a run ever completed, and marking every
// backgrounded agent as awaiting input would be wrong in the common case.
const isAwaitingInput = (conversation: PixelAgentsConversation): boolean =>
  conversation.eventsLoaded && !hasCompletedRun(conversation.events)

type WorkspaceMemo = Pick<
  PixelAgentsWorkspaceRecord,
  'layout' | 'agentMeta' | 'agentNumbers' | 'nextAgentNumber'
>

const EMPTY_WORKSPACE: WorkspaceMemo = {
  layout: null,
  agentMeta: {},
  agentNumbers: {},
  nextAgentNumber: 1
}

type ConversationActivityBridgeProps = {
  conversation: PixelAgentsConversation
  agentId: number
  enabled: boolean
  onMessages: (messages: readonly PixelServerMessage[]) => void
}

// `useLiveChatActivity` is a hook, so it can't be called in a loop: the stage
// mounts one of these (non-rendering) per conversation, each wiring its own
// hook instance to that conversation's events/isRunning and stamping every
// projected message with ITS agent id (issue #430).
//
// Reset-while-idle needs no special handling here. A conversation that was
// ever running already cleared its tool pills the moment its last run ended
// (`agent.run.completed` -> `agentToolsClear`, or the abort path below), so by
// the time it's idle there is nothing stale left to clear; a reset only wipes
// `events`, which this hook does not react to on its own (its effect only
// acts on an `isRunning` transition). And reset-WHILE-running is already
// covered: `resetConversationAction` aborts the run first, which flips
// `isRunning` false without ever appending a completion event — this hook's
// existing `onRunEnded` branch (fed by that transition, not by any specific
// event) fires exactly the same `agentToolsClear` + `agentStatus: waiting`
// pair regardless of *why* the run ended. See workspace-db.ts and this
// component's caller for the corresponding agent-number lifecycle.
const ConversationActivityBridge = ({
  conversation,
  agentId,
  enabled,
  onMessages
}: ConversationActivityBridgeProps): null => {
  useLiveChatActivity(conversation.events, conversation.isRunning, {
    enabled,
    onRunStarted: () =>
      onMessages([
        { type: 'agentToolsClear', id: agentId },
        { type: 'agentStatus', id: agentId, status: 'active' }
      ]),
    onRunEnded: () =>
      onMessages([
        { type: 'agentToolsClear', id: agentId },
        { type: 'agentStatus', id: agentId, status: 'waiting', awaitingInput: false }
      ]),
    onLiveEvents: (liveEvents) =>
      onMessages(liveEvents.flatMap((event) => messagesForChatEvent(event, agentId)))
  })
  return null
}

export const PixelAgentsWorkspace = ({
  assistant,
  conversations,
  activeConversationId,
  actions
}: PixelAgentsStageProps): React.JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const conversationsRef = useRef(conversations)
  const activeConversationIdRef = useRef(activeConversationId)
  // Mirrored like the refs above so the mount effect below never re-runs (and
  // so never re-navigates the iframe) just because a caller passes a fresh
  // `actions` object identity on some unrelated re-render.
  const actionsRef = useRef(actions)
  const bootstrappingRef = useRef(false)
  // Imperative source of truth (always fresh, unlike React state, for reads
  // inside the postMessage handler and the reconciliation effect below).
  const workspaceRef = useRef<WorkspaceMemo>(EMPTY_WORKSPACE)
  // Mirrors `workspaceRef.current.agentNumbers` in React state: the per-
  // conversation activity bridges below are rendered from this, and a ref
  // alone can't trigger the re-render a freshly assigned number needs.
  const [agentNumbers, setAgentNumbers] = useState<Record<string, number>>({})
  // De-dupes `agentSelected`: several state updates can resolve to the same
  // agent id (e.g. an unrelated conversation being created also touches this
  // effect's deps), and re-posting is visible office churn worth avoiding.
  const lastSelectedAgentIdRef = useRef<number | undefined>(undefined)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [pixelAgentsUrl, setPixelAgentsUrl] = useState<string | undefined>()
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  // Gates useLiveChatActivity below: activity only starts once the bootstrap
  // handshake has posted the initial office state, replacing the old readyRef.
  const [activityEnabled, setActivityEnabled] = useState(false)

  conversationsRef.current = conversations
  activeConversationIdRef.current = activeConversationId
  actionsRef.current = actions

  const postToPixelAgents = useCallback((message: PixelServerMessage): void => {
    // The sandboxed frame has an opaque origin that can't be named as a
    // postMessage targetOrigin; delivery is already pinned to it via
    // contentWindow, and the payload is only visualization data.
    frameRef.current?.contentWindow?.postMessage(
      { channel: PIXEL_AGENTS_BRIDGE_CHANNEL, direction: 'server', message },
      '*'
    )
  }, [])

  const postMany = useCallback(
    (messages: readonly PixelServerMessage[]): void => {
      for (const message of messages) postToPixelAgents(message)
    },
    [postToPixelAgents]
  )

  const persistWorkspace = useCallback((update: Partial<WorkspaceMemo>): void => {
    workspaceRef.current = { ...workspaceRef.current, ...update }
    if (update.agentNumbers) {
      setAgentNumbers(update.agentNumbers)
    }
    const snapshot = workspaceRef.current
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => savePixelAgentsWorkspace(snapshot))
      .then(
        () => setStorageError(null),
        () => setStorageError('Pixel Agents layout changes could not be saved in this browser.')
      )
  }, [])

  // Reverse lookup for `focusAgent`/`closeAgent`, which name an agent NUMBER;
  // the store's actions take a conversation id.
  const conversationIdForAgent = useCallback((agentId: number): string | undefined => {
    for (const [conversationId, id] of Object.entries(workspaceRef.current.agentNumbers)) {
      if (id === agentId) return conversationId
    }
    return undefined
  }, [])

  useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        // A sandboxed (opaque-origin) frame serializes its origin as the literal
        // string "null"; the contentWindow check above is what pins identity.
        event.origin !== 'null'
      )
        return
      const message = parsePixelClientEnvelope(event.data)
      if (!message) return

      if (message.type === 'saveLayout') {
        persistWorkspace({ layout: message.layout })
        return
      }
      if (message.type === 'saveAgentSeats') {
        // Seats are keyed by agent NUMBER (issue #430: persist every entry,
        // not just a hardcoded '1') — but only entries for numbers CURRENTLY
        // assigned to a conversation. The sandboxed iframe is untrusted by this
        // architecture's own isolation rationale, and it can name any integer
        // key: without this filter a retired number (dropped from
        // `agentNumbers` by `retireAgentNumber`, but not necessarily from
        // `agentMeta` in the same breath) gets silently re-added here, growing
        // `agentMeta` unboundedly across create/delete churn and re-posting the
        // orphan in `existingAgents` on every future bootstrap. Numbers are
        // always assigned (via `resolveAgentNumber`) before the office can ever
        // learn about — and therefore seat — an agent, so no legitimate seat is
        // dropped by this filter.
        const assignedAgentIds = new Set(Object.values(workspaceRef.current.agentNumbers))
        const nextAgentMeta: Record<number, PixelAgentMeta> = { ...workspaceRef.current.agentMeta }
        for (const [key, seat] of Object.entries(message.seats)) {
          const agentId = Number(key)
          if (!Number.isInteger(agentId) || !assignedAgentIds.has(agentId)) continue
          nextAgentMeta[agentId] = {
            palette: seat.palette,
            hueShift: seat.hueShift,
            ...(seat.seatId ? { seatId: seat.seatId } : {})
          }
        }
        persistWorkspace({ agentMeta: nextAgentMeta })
        return
      }
      if (message.type === 'focusAgent') {
        // Clicking a character: make its conversation active in the assistant
        // panel. Unknown agent id (e.g. a stale message racing a delete) is a
        // no-op.
        const conversationId = conversationIdForAgent(message.id)
        if (conversationId) actionsRef.current.selectConversation(conversationId)
        return
      }
      if (message.type === 'launchAgent') {
        // Office toolbar "+ Agent": start a new conversation. Upstream's
        // folderPath/bypassPermissions have no meaning in a single-workspace
        // chat store — see the protocol schema comment.
        actionsRef.current.startNewConversation()
        return
      }
      if (message.type === 'closeAgent') {
        // The upstream webview only sends this from its own "×" button, which
        // only renders on an ALREADY-selected character and stops the click
        // from also re-triggering `focusAgent` (`office/components/
        // ToolOverlay.tsx`: `isSelected && !isSub` gates the button,
        // `e.stopPropagation()` on its click). That select-then-explicit-close
        // two-step is upstream's own deliberate-interaction guard — the same
        // shape as this app's header conversation switcher (arm-then-confirm,
        // no `window.confirm`) — so `closeAgent` is honored directly here with
        // no extra host-side confirmation.
        const conversationId = conversationIdForAgent(message.id)
        if (conversationId) actionsRef.current.deleteConversation(conversationId)
        return
      }
      if (message.type !== 'webviewReady' || bootstrappingRef.current) return

      bootstrappingRef.current = true
      void Promise.all([
        // Static, same-origin build asset: stage-local failure UI handles this before telemetry is ready.
        // eslint-disable-next-line no-restricted-globals
        fetch(upstreamUrl('tinytinkerer-bootstrap.json')).then(async (response) => {
          if (!response.ok)
            throw new Error(`Pixel Agents bootstrap request failed (${response.status})`)
          return parsePixelAgentsBootstrap(await response.json())
        }),
        loadPixelAgentsWorkspace()
      ])
        .then(([bootstrap, { record: saved, migratedFromLegacy }]) => {
          const currentConversations = conversationsRef.current
          const currentActiveId = activeConversationIdRef.current
          const layout = saved?.layout ?? null
          const agentMeta = saved?.agentMeta ?? {}

          // Adopt a freshly migrated legacy seat onto the oldest conversation
          // (issue #430 decision #4 / plan section 5 — see workspace-db.ts).
          // Gated on the actual migration marker, NOT merely on the resulting
          // shape (empty `agentNumbers` + meta for 1) — a modern record can
          // reach that same shape after every conversation is deleted, and
          // adopting then would re-issue a retired number (see workspace-db.ts).
          let agentNumbersNext = migratedFromLegacy
            ? adoptLegacySeat(
                saved?.agentNumbers ?? {},
                agentMeta,
                currentConversations.map((conversation) => conversation.id)
              )
            : (saved?.agentNumbers ?? {})
          let nextAgentNumberNext = saved?.nextAgentNumber ?? 1

          const bootstrapAgents: PixelBootstrapAgent[] = []
          for (const conversation of currentConversations) {
            const assignment = resolveAgentNumber(
              agentNumbersNext,
              nextAgentNumberNext,
              conversation.id
            )
            agentNumbersNext = assignment.agentNumbers
            nextAgentNumberNext = assignment.nextAgentNumber
            bootstrapAgents.push({
              agentId: assignment.agentNumber,
              title: conversation.title,
              isRunning: conversation.isRunning,
              awaitingInput: isAwaitingInput(conversation)
            })
          }

          const activeAgentId =
            currentActiveId !== undefined ? agentNumbersNext[currentActiveId] : undefined
          lastSelectedAgentIdRef.current = activeAgentId

          // Persist before posting: the reconciliation/selection effects read
          // `workspaceRef.current` synchronously once this render commits.
          persistWorkspace({
            layout,
            agentMeta,
            agentNumbers: agentNumbersNext,
            nextAgentNumber: nextAgentNumberNext
          })
          postMany(
            createPixelBootstrapMessages(
              bootstrap,
              layout,
              bootstrapAgents,
              agentMeta,
              activeAgentId
            )
          )
          setActivityEnabled(true)
          setBootstrapError(null)
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          setBootstrapError(`Pixel Agents could not start. ${detail}`)
        })
        .finally(() => {
          bootstrappingRef.current = false
        })
    }

    window.addEventListener('message', handleMessage)
    // Do not navigate the iframe until its parent listener is installed. This closes
    // the fast-cache race where the upstream webview could send webviewReady first.
    // The sandboxed frame can't read our origin itself (it's opaque there), so it
    // rides in once as a query parameter; the bridge uses it as its outbound
    // postMessage targetOrigin.
    const src = new URL(upstreamUrl('index.html'))
    src.searchParams.set('tinytinkerer-parent-origin', window.location.origin)
    setPixelAgentsUrl(src.href)
    return () => window.removeEventListener('message', handleMessage)
  }, [conversationIdForAgent, persistWorkspace, postMany])

  // Reconcile the office's agent set against the current conversation list
  // (issue #430): a conversation with no number yet is new -> assign one and
  // announce `agentCreated`; a number with no matching conversation anymore
  // was deleted -> announce `agentClosed` and retire it. Gated on
  // `activityEnabled` so this never races the bootstrap handshake above (which
  // already accounts for every conversation that existed at that point).
  useEffect(() => {
    if (!activityEnabled) return
    const currentIds = new Set(conversations.map((conversation) => conversation.id))

    for (const [conversationId, agentId] of Object.entries(workspaceRef.current.agentNumbers)) {
      if (currentIds.has(conversationId)) continue
      const retired = retireAgentNumber(
        workspaceRef.current.agentNumbers,
        workspaceRef.current.agentMeta,
        conversationId
      )
      persistWorkspace({ agentNumbers: retired.agentNumbers, agentMeta: retired.agentMeta })
      postToPixelAgents({ type: 'agentClosed', id: agentId })
    }

    for (const conversation of conversations) {
      if (workspaceRef.current.agentNumbers[conversation.id] !== undefined) continue
      const assignment = resolveAgentNumber(
        workspaceRef.current.agentNumbers,
        workspaceRef.current.nextAgentNumber,
        conversation.id
      )
      persistWorkspace({
        agentNumbers: assignment.agentNumbers,
        nextAgentNumber: assignment.nextAgentNumber
      })
      postMany([
        { type: 'agentCreated', id: assignment.agentNumber, folderName: conversation.title },
        {
          type: 'agentStatus',
          id: assignment.agentNumber,
          status: conversation.isRunning ? 'active' : 'waiting',
          ...(!conversation.isRunning ? { awaitingInput: isAwaitingInput(conversation) } : {})
        }
      ])
    }
  }, [conversations, activityEnabled, persistWorkspace, postMany, postToPixelAgents])

  // Follow the active conversation: tell the office which character to select.
  // Depends on `agentNumbers` (state, not the ref) so this re-runs once a
  // brand-new active conversation's number lands from the reconciliation
  // effect above (same commit's `conversations`-triggered run schedules that
  // state update; this effect then re-fires on the following one).
  useEffect(() => {
    if (!activityEnabled || activeConversationId === undefined) return
    const agentId = agentNumbers[activeConversationId]
    if (agentId === undefined || agentId === lastSelectedAgentIdRef.current) return
    lastSelectedAgentIdRef.current = agentId
    postToPixelAgents({ type: 'agentSelected', id: agentId })
  }, [activeConversationId, activityEnabled, agentNumbers, postToPixelAgents])

  const pixelAgents = (
    <div className="pixel-agents-frame-shell">
      {bootstrapError ? (
        <div className="pixel-agents-error" role="alert">
          <span>{bootstrapError}</span>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}
      {storageError ? (
        <p className="pixel-agents-storage-error" role="alert">
          {storageError}
        </p>
      ) : null}
      {/* The third-party bundle must not share TinyTinkerer's origin (IndexedDB,
          auth, parent DOM); everything it needs arrives over the postMessage bridge. */}
      <iframe
        ref={frameRef}
        src={pixelAgentsUrl}
        title="Pixel Agents office"
        sandbox="allow-scripts"
      />
    </div>
  )

  return (
    <main className="pixel-agents-root" aria-label="TinyTinkerer Pixel Agents">
      {conversations.map((conversation) => {
        const agentId = agentNumbers[conversation.id]
        // Not yet assigned (bootstrap/reconciliation hasn't reached it this
        // tick): nothing to project until it has an agent id to stamp.
        if (agentId === undefined) return null
        return (
          <ConversationActivityBridge
            key={conversation.id}
            conversation={conversation}
            agentId={agentId}
            enabled={activityEnabled}
            onMessages={postMany}
          />
        )
      })}
      <DockablePanelLayout
        title="Pixel Agents workspace"
        storageKey="tinytinkerer:pixel-agents-workspace-layout:v1"
        panels={[
          { id: 'pixel-agents', title: 'Pixel Agents', content: pixelAgents },
          { id: 'assistant', title: 'Assistant', content: assistant }
        ]}
      />
    </main>
  )
}
