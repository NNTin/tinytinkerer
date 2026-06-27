import { useEffect } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { setCanvasApi } from '../../canvas-bridge'

// The full-window Excalidraw whiteboard. This is the ONLY module that statically
// imports @excalidraw/excalidraw, and it is loaded via React.lazy from CanvasPage
// so the large library code-splits into the excalidraw-vendor chunk and never
// touches the startup entry bundle. On mount it registers the imperative API with
// the canvas bridge (the seam the chat tools read); on unmount it clears it.
export const ExcalidrawCanvas = () => {
  useEffect(
    () => () => {
      setCanvasApi(null)
    },
    []
  )

  return (
    <div className="canvas-surface">
      <Excalidraw
        excalidrawAPI={(api) => {
          setCanvasApi(api)
        }}
      />
    </div>
  )
}

export default ExcalidrawCanvas
