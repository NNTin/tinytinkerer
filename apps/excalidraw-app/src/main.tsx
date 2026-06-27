import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createExcalidrawBridge } from './bridge'
import { readSessionNonce } from './session-nonce'
import './index.css'

const sessionNonce = readSessionNonce(window.location.hash)

const ExcalidrawApp = (): React.JSX.Element => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (!api || !sessionNonce) return
    const server = createExcalidrawBridge(api, sessionNonce)
    return () => server.dispose()
  }, [api])

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

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element.')

createRoot(root).render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>
)
