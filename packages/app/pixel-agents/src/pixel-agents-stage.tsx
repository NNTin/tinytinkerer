import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { DockablePanelLayout, useLiveChatActivity } from '@tinytinkerer/app-shell'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForChatEvent } from './activity'
import {
  PIXEL_AGENT_ID,
  PIXEL_AGENTS_BRIDGE_CHANNEL,
  createPixelBootstrapMessages,
  parsePixelAgentsBootstrap,
  parsePixelClientEnvelope,
  type PixelAgentMeta,
  type PixelServerMessage
} from './protocol'
import type { PixelAgentsStageProps } from './stage-props'
import {
  loadPixelAgentsWorkspace,
  savePixelAgentsWorkspace,
  type PixelAgentsWorkspaceRecord
} from './workspace-db'

const upstreamUrl = (path: string): string => new URL(`upstream/${path}`, document.baseURI).href

const hasCompletedRun = (events: readonly ChatEvent[]): boolean =>
  events.some((event) => event.type === 'agent.run.completed')

export const PixelAgentsWorkspace = ({
  assistant,
  events,
  isRunning
}: PixelAgentsStageProps): React.JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const eventsRef = useRef(events)
  const isRunningRef = useRef(isRunning)
  const bootstrappingRef = useRef(false)
  const workspaceRef = useRef<Pick<PixelAgentsWorkspaceRecord, 'layout' | 'agentMeta'>>({
    layout: null,
    agentMeta: {}
  })
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [pixelAgentsUrl, setPixelAgentsUrl] = useState<string | undefined>()
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  // Gates useLiveChatActivity below: activity only starts once the bootstrap
  // handshake has posted the initial office state, replacing the old readyRef.
  const [activityEnabled, setActivityEnabled] = useState(false)

  eventsRef.current = events
  isRunningRef.current = isRunning

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

  const persistWorkspace = useCallback(
    (update: Partial<Pick<PixelAgentsWorkspaceRecord, 'layout' | 'agentMeta'>>): void => {
      workspaceRef.current = { ...workspaceRef.current, ...update }
      const snapshot = workspaceRef.current
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => savePixelAgentsWorkspace(snapshot))
        .then(
          () => setStorageError(null),
          () => setStorageError('Pixel Agents layout changes could not be saved in this browser.')
        )
    },
    []
  )

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
        const seat = message.seats['1']
        if (!seat) return
        const agentMeta: PixelAgentMeta = {
          palette: seat.palette,
          hueShift: seat.hueShift,
          ...(seat.seatId ? { seatId: seat.seatId } : {})
        }
        persistWorkspace({ agentMeta })
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
        .then(([bootstrap, saved]) => {
          workspaceRef.current = {
            layout: saved?.layout ?? null,
            agentMeta: saved?.agentMeta ?? {}
          }
          const currentEvents = eventsRef.current
          const currentlyRunning = isRunningRef.current
          postMany(
            createPixelBootstrapMessages(
              bootstrap,
              workspaceRef.current.layout,
              workspaceRef.current.agentMeta,
              currentlyRunning,
              !hasCompletedRun(currentEvents)
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
  }, [persistWorkspace, postMany])

  useLiveChatActivity(events, isRunning, {
    enabled: activityEnabled,
    onRunStarted: () =>
      postMany([
        { type: 'agentToolsClear', id: PIXEL_AGENT_ID },
        { type: 'agentStatus', id: PIXEL_AGENT_ID, status: 'active' }
      ]),
    onRunEnded: () =>
      postMany([
        { type: 'agentToolsClear', id: PIXEL_AGENT_ID },
        { type: 'agentStatus', id: PIXEL_AGENT_ID, status: 'waiting', awaitingInput: false }
      ]),
    onLiveEvents: (liveEvents) => postMany(liveEvents.flatMap(messagesForChatEvent))
  })

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
