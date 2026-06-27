import { lazy, Suspense } from 'react'
import { FloatingWidgetChat } from '@tinytinkerer/app-browser'
import { CanvasChatLoading, CanvasSurfaceLoading } from '../../app/loading-screen'

// Excalidraw is its own lazy chunk (excalidraw-vendor) — never statically imported
// into this route — so the entry/route budgets hold.
const ExcalidrawCanvas = lazy(() => import('./excalidraw-canvas'))

// Layout persists separately from the embeddable widget app's key.
const CANVAS_LAYOUT_KEY = 'tinytinkerer:canvas-layout:v1'

// The canvas app: a full-window whiteboard with the shared floating chat on top.
// The chat reuses the exact widget chrome (FloatingWidgetChat) and its draw/read/
// clear tools drive the canvas through the canvas bridge.
export const CanvasPage = () => (
  <div className="canvas-root">
    <Suspense fallback={<CanvasSurfaceLoading />}>
      <ExcalidrawCanvas />
    </Suspense>
    {/* Click-through overlay: only the floating shell captures pointer events, so
        the whiteboard beneath stays fully usable. */}
    <div className="canvas-chat-overlay">
      <FloatingWidgetChat
        viewMode="standalone"
        storageKey={CANVAS_LAYOUT_KEY}
        LoadingComponent={CanvasChatLoading}
      />
    </div>
  </div>
)
