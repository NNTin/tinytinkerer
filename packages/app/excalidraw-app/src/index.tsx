import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createExcalidrawBridge } from './bridge'
import { readSessionNonce } from './session-nonce'
import './styles.css'

const ExcalidrawApp = ({ sessionNonce }: { sessionNonce: string | null }): React.JSX.Element => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (!api || !sessionNonce) return
    const server = createExcalidrawBridge(api, sessionNonce)
    return () => server.dispose()
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
