import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DockablePanelLayout } from '@tinytinkerer/app-shell'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForUnseenChatEvents } from './activity'
import {
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

const seedSeenEvents = (events: readonly ChatEvent[], isRunning: boolean): Set<string> => {
  if (!isRunning) return new Set(events.map((event) => event.id))
  let runStart = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'agent.run.started') {
      runStart = index
      break
    }
  }
  return new Set(events.slice(0, runStart + 1).map((event) => event.id))
}

export const PixelAgentsWorkspace = ({
  assistant,
  events,
  isRunning
}: PixelAgentsStageProps): React.JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const eventsRef = useRef(events)
  const isRunningRef = useRef(isRunning)
  const readyRef = useRef(false)
  const bootstrappingRef = useRef(false)
  const seenEventsRef = useRef<Set<string>>(new Set())
  const wasRunningRef = useRef(isRunning)
  const workspaceRef = useRef<Pick<PixelAgentsWorkspaceRecord, 'layout' | 'agentMeta'>>({
    layout: null,
    agentMeta: {}
  })
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [pixelAgentsUrl, setPixelAgentsUrl] = useState<string | undefined>()
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)

  eventsRef.current = events
  isRunningRef.current = isRunning

  const postToPixelAgents = useCallback((message: PixelServerMessage): void => {
    frameRef.current?.contentWindow?.postMessage(
      { channel: PIXEL_AGENTS_BRIDGE_CHANNEL, direction: 'server', message },
      window.location.origin
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
        event.origin !== window.location.origin
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
          seenEventsRef.current = seedSeenEvents(currentEvents, currentlyRunning)
          wasRunningRef.current = currentlyRunning
          postMany(
            createPixelBootstrapMessages(
              bootstrap,
              workspaceRef.current.layout,
              workspaceRef.current.agentMeta,
              currentlyRunning,
              !hasCompletedRun(currentEvents)
            )
          )
          readyRef.current = true
          if (currentlyRunning) {
            postMany(messagesForUnseenChatEvents(currentEvents, seenEventsRef.current))
          }
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
    setPixelAgentsUrl(upstreamUrl('index.html'))
    return () => window.removeEventListener('message', handleMessage)
  }, [persistWorkspace, postMany])

  useEffect(() => {
    if (!readyRef.current) return

    if (isRunning && !wasRunningRef.current) {
      seenEventsRef.current = seedSeenEvents(events, true)
      postMany([
        { type: 'agentToolsClear', id: 1 },
        { type: 'agentStatus', id: 1, status: 'active' }
      ])
    }

    if (isRunning) {
      postMany(messagesForUnseenChatEvents(events, seenEventsRef.current))
    } else if (wasRunningRef.current) {
      postMany([
        { type: 'agentToolsClear', id: 1 },
        { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: false }
      ])
      seenEventsRef.current = new Set(events.map((event) => event.id))
    }
    wasRunningRef.current = isRunning
  }, [events, isRunning, postMany])

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
      <iframe ref={frameRef} src={pixelAgentsUrl} title="Pixel Agents office" />
      <div className="pixel-agents-credit">
        Visualization by{' '}
        <a href="https://github.com/pixel-agents-hq/pixel-agents/" target="_blank" rel="noreferrer">
          Pixel Agents
        </a>
        {' · '}
        <a href={upstreamUrl('PIXEL_AGENTS_LICENSE.txt')} target="_blank" rel="noreferrer">
          MIT License
        </a>
      </div>
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
