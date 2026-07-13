import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState
} from '@excalidraw/excalidraw/types'
import { DockablePanelLayout } from '@tinytinkerer/app-shell'
import { createCanvasController } from './controller'
import { canvasControllerHandle } from './controller-handle'
import type { CanvasStageProps } from './stage-props'
import type { ExcalidrawSnapshot } from './inputs'
import { useLibraryImportRelay } from './library-relay'
import { createScenePersistence } from './persistence'
import { loadCanvasSnapshot, saveCanvasSnapshot } from './workspace-db'

const resolveLibraryReturnUrl = (): string | undefined => {
  try {
    return new URL('library-callback/', document.baseURI).href
  } catch {
    return undefined
  }
}

const initialDataFrom = (snapshot: ExcalidrawSnapshot | null): ExcalidrawInitialDataState | null =>
  snapshot
    ? ({
        elements: snapshot.elements,
        ...(snapshot.appState ? { appState: snapshot.appState } : {}),
        ...(snapshot.libraryItems ? { libraryItems: snapshot.libraryItems } : {})
      } as unknown as ExcalidrawInitialDataState)
    : null

export const CanvasWorkspace = ({ assistant }: CanvasStageProps): React.JSX.Element => {
  const [loaded, setLoaded] = useState(false)
  const [snapshot, setSnapshot] = useState<ExcalidrawSnapshot | null>(null)
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const libraryItemsRef = useRef<readonly unknown[]>([])
  const saveRef = useRef<() => void>(() => {})
  const libraryReturnUrl = useMemo(resolveLibraryReturnUrl, [])

  useEffect(() => {
    let active = true
    void loadCanvasSnapshot().then((saved) => {
      if (!active) return
      libraryItemsRef.current = saved?.libraryItems ?? []
      setSnapshot(saved)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!api) return
    const controller = createCanvasController(api)
    canvasControllerHandle.setController(controller)
    const persistence = createScenePersistence(
      api,
      (next) => {
        void saveCanvasSnapshot(next)
          .then(() => setStorageError(null))
          .catch(() => setStorageError('Canvas changes could not be saved in this browser.'))
      },
      () => libraryItemsRef.current
    )
    saveRef.current = persistence.save
    return () => {
      saveRef.current = () => {}
      persistence.dispose()
      canvasControllerHandle.setController(null)
    }
  }, [api])

  useLibraryImportRelay(api)

  const handleLibraryChange = useCallback((items: readonly unknown[]) => {
    libraryItemsRef.current = items
    saveRef.current()
  }, [])

  if (!loaded) return <div className="canvas-loading">Opening canvas…</div>

  const canvas = (
    <div className="canvas-whiteboard">
      {storageError ? (
        <p className="canvas-storage-error" role="alert">
          {storageError}
        </p>
      ) : null}
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialDataFrom(snapshot)}
        onLibraryChange={handleLibraryChange}
        {...(libraryReturnUrl ? { libraryReturnUrl } : {})}
      />
    </div>
  )

  return (
    <main className="canvas-root" aria-label="TinyTinkerer Canvas">
      <DockablePanelLayout
        title="Canvas workspace"
        storageKey="tinytinkerer:canvas-workspace-layout:v1"
        panels={[
          { id: 'canvas', title: 'Canvas', content: canvas },
          { id: 'assistant', title: 'Assistant', content: assistant }
        ]}
      />
    </main>
  )
}
