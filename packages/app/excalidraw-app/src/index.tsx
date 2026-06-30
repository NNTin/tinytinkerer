import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { APP_SNAPSHOT_EVENT } from '@tinytinkerer/app-bridge'
import { createExcalidrawBridge } from './bridge'
import { subscribeScenePersistence } from './persistence'
import { readSessionNonce } from './session-nonce'
import './styles.css'

const ExcalidrawApp = ({ sessionNonce }: { sessionNonce: string | null }): React.JSX.Element => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (!api || !sessionNonce) return
    const server = createExcalidrawBridge(api, sessionNonce)
    // Ship a debounced snapshot to the harness on every scene change. The harness
    // (real origin) persists it and replays it via APP_SNAPSHOT_RESTORE_VERB on the
    // next mount — this opaque-origin iframe has no Web Storage of its own.
    const stopPersistence = subscribeScenePersistence(api, (snapshot) =>
      server.emit(APP_SNAPSHOT_EVENT, snapshot)
    )
    return () => {
      stopPersistence()
      server.dispose()
    }
  }, [api, sessionNonce])

  if (!sessionNonce) {
    return (
      <main className="excalidraw-app-error" role="alert">
        This Excalidraw app must be opened by the canvas harness.
      </main>
    )
  }

  return (
    <main className="excalidraw-app">
      <Excalidraw excalidrawAPI={setApi} />
    </main>
  )
}

export const mountExcalidrawApp = (
  rootElement: HTMLElement,
  locationHash: string
): (() => void) => {
  const root: Root = createRoot(rootElement)
  root.render(
    <StrictMode>
      <ExcalidrawApp sessionNonce={readSessionNonce(locationHash)} />
    </StrictMode>
  )
  return () => root.unmount()
}
