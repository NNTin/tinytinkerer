import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { APP_SNAPSHOT_EVENT } from '@tinytinkerer/app-bridge'
import { createExcalidrawBridge } from './bridge'
import { createScenePersistence } from './persistence'
import { readSessionNonce } from './session-nonce'
import './styles.css'

// Where libraries.excalidraw.com should send the user back after "Add to Excalidraw".
// This opaque-origin iframe cannot receive that round-trip itself, so we point it at
// the shell's same-origin `/canvas/library-callback/` page, which relays the library
// back into this iframe over the bridge. Derived from the iframe's real URL (the
// `origin` is "null" under the sandbox, but `href` still holds the real address).
const resolveLibraryReturnUrl = (): string | undefined => {
  try {
    return new URL('../library-callback/', window.location.href).href
  } catch {
    return undefined
  }
}

const ExcalidrawApp = ({ sessionNonce }: { sessionNonce: string | null }): React.JSX.Element => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  // Latest library items (from onLibraryChange) and a stable handle to the active
  // debounced save, so the library render prop can trigger a snapshot too.
  const libraryItemsRef = useRef<readonly unknown[]>([])
  const saveRef = useRef<() => void>(() => {})
  const libraryReturnUrl = useMemo(resolveLibraryReturnUrl, [])

  useEffect(() => {
    if (!api || !sessionNonce) return
    const server = createExcalidrawBridge(api, sessionNonce)
    // Ship a debounced snapshot to the harness on every scene/library change. The
    // harness (real origin) persists it and replays it via APP_SNAPSHOT_RESTORE_VERB
    // on the next mount — this opaque-origin iframe has no Web Storage of its own.
    const persistence = createScenePersistence(
      api,
      (snapshot) => server.emit(APP_SNAPSHOT_EVENT, snapshot),
      () => libraryItemsRef.current
    )
    saveRef.current = persistence.save
    return () => {
      saveRef.current = () => {}
      persistence.dispose()
      server.dispose()
    }
  }, [api, sessionNonce])

  const handleLibraryChange = useCallback((items: readonly unknown[]) => {
    libraryItemsRef.current = items
    saveRef.current()
  }, [])

  if (!sessionNonce) {
    return (
      <main className="excalidraw-app-error" role="alert">
        This Excalidraw app must be opened by the canvas harness.
      </main>
    )
  }

  return (
    <main className="excalidraw-app">
      <Excalidraw
        excalidrawAPI={setApi}
        onLibraryChange={handleLibraryChange}
        {...(libraryReturnUrl ? { libraryReturnUrl } : {})}
      />
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
