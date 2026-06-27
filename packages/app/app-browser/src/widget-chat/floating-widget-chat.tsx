import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { TINYTINKERER_BRAND_ASSET_URLS } from '@tinytinkerer/brand-assets'
import { useBrowserShellConfig } from '../hooks'
import { shellThemeToCssVars } from '../shell-theme'
import { WidgetChatSurface, type WidgetChatLoadingComponent } from './widget-chat-surface'

// The floating, movable/resizable chat window shared by the widget app and the
// canvas app's overlay. It owns ALL the window chrome and the standalone layout
// state machine (drag/resize/keyboard nudge/minimize/persistence) plus the
// host-embed (iframe) mode that posts drag/state to the parent. The chat body is
// the shared WidgetChatSurface; per-app concerns (which view mode, where layout
// persists, the boot copy) arrive as props — no shell is named here.

const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
// Keyboard nudge step for moving/resizing the standalone window (C1).
const WIDGET_KEYBOARD_STEP = 16

const DEFAULT_DIMS = {
  defaultWidth: 400,
  defaultHeight: 680,
  minWidth: 320,
  minHeight: 420
}

type WidgetDims = typeof DEFAULT_DIMS

export type FloatingWidgetChatProps = {
  // Which presentation: a free-floating window on its own page ('standalone') or
  // an iframe embedded in a host page ('host', which posts drag/state to parent).
  viewMode: 'host' | 'standalone'
  // Start minimized (host mode passes the embedder's requested window mode).
  initialMinimized?: boolean
  // localStorage key the standalone layout persists under (per app).
  storageKey: string
  // The compact-session loading/error view, supplied by the host app.
  LoadingComponent: WidgetChatLoadingComponent
  // Window sizing overrides; defaults match the widget's historical sizes.
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  // Passed through to the chat body's frame.
  framed?: boolean
  // Extra class on the outer stage — the canvas overlay uses it to make the stage
  // click-through (pointer-events: none) so the whiteboard beneath stays usable
  // while the floating shell (pointer-events: auto) remains interactive.
  stageClassName?: string
}

type WidgetLayout = {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const clampLayout = (layout: WidgetLayout, dims: WidgetDims): WidgetLayout => {
  const width = clamp(
    Math.round(layout.width),
    dims.minWidth,
    Math.max(dims.minWidth, window.innerWidth - WIDGET_SAFE_MARGIN * 2)
  )
  const height = clamp(
    Math.round(layout.height),
    dims.minHeight,
    Math.max(dims.minHeight, window.innerHeight - WIDGET_SAFE_MARGIN * 2)
  )
  const boxWidth = layout.minimized ? WIDGET_MINIMIZED_SIZE : width
  const boxHeight = layout.minimized ? WIDGET_MINIMIZED_SIZE : height

  return {
    ...layout,
    width,
    height,
    x: clamp(
      Math.round(layout.x),
      WIDGET_SAFE_MARGIN,
      Math.max(WIDGET_SAFE_MARGIN, window.innerWidth - boxWidth - WIDGET_SAFE_MARGIN)
    ),
    y: clamp(
      Math.round(layout.y),
      WIDGET_SAFE_MARGIN,
      Math.max(WIDGET_SAFE_MARGIN, window.innerHeight - boxHeight - WIDGET_SAFE_MARGIN)
    )
  }
}

const createDefaultStandaloneLayout = (dims: WidgetDims): WidgetLayout =>
  clampLayout(
    {
      x: Math.round((window.innerWidth - dims.defaultWidth) / 2),
      y: Math.round(window.innerHeight - dims.defaultHeight - 32),
      width: dims.defaultWidth,
      height: dims.defaultHeight,
      minimized: false
    },
    dims
  )

const loadStandaloneLayout = (storageKey: string, dims: WidgetDims): WidgetLayout => {
  const stored = window.localStorage.getItem(storageKey)
  if (!stored) {
    return createDefaultStandaloneLayout(dims)
  }

  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null) {
      return createDefaultStandaloneLayout(dims)
    }
    const r = parsed as Record<string, unknown>
    if (
      typeof r.x !== 'number' ||
      typeof r.y !== 'number' ||
      typeof r.width !== 'number' ||
      typeof r.height !== 'number'
    ) {
      return createDefaultStandaloneLayout(dims)
    }

    return clampLayout(
      {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        minimized: r.minimized === true
      },
      dims
    )
  } catch {
    return createDefaultStandaloneLayout(dims)
  }
}

const saveStandaloneLayout = (storageKey: string, layout: WidgetLayout): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(layout))
}

const WidgetLauncher = ({ onRestore }: { onRestore: () => void }) => (
  <div className="flex h-full items-center justify-center p-2">
    <button
      type="button"
      onClick={onRestore}
      aria-label="Restore widget"
      className="widget-launcher inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.16)]"
    >
      <img src={TINYTINKERER_BRAND_ASSET_URLS.icon192} alt="" className="h-11 w-11 rounded-2xl" />
      <span className="sr-only">Restore widget</span>
    </button>
  </div>
)

const WidgetShellBar = ({
  onMinimize,
  onMovePointerDown,
  onMoveKeyDown
}: {
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) => (
  <div className="widget-shell-bar border-b border-[var(--widget-border)]">
    <button
      type="button"
      className="widget-shell-grip"
      aria-label="Move widget. Use arrow keys to move, Shift with arrow keys to resize."
      title="Move widget (arrow keys move, Shift+arrows resize)"
      onPointerDown={onMovePointerDown}
      {...(onMoveKeyDown ? { onKeyDown: onMoveKeyDown } : {})}
    />
    <button
      type="button"
      className="widget-shell-minimize"
      aria-label="Minimize widget"
      title="Minimize widget"
      onClick={onMinimize}
    >
      <span aria-hidden="true" />
    </button>
  </div>
)

const WidgetWindow = ({
  minimized,
  dragging,
  onRestore,
  onMinimize,
  onMovePointerDown,
  onMoveKeyDown,
  children,
  resizeHandle,
  className,
  style
}: {
  minimized: boolean
  dragging: boolean
  onRestore: () => void
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  children: ReactNode
  resizeHandle?: ReactNode
  className?: string
  style?: CSSProperties
}) => (
  <div
    className={['widget-floating-shell', className].filter(Boolean).join(' ')}
    data-dragging={dragging ? 'true' : 'false'}
    data-minimized={minimized ? 'true' : 'false'}
    style={style}
  >
    <div className="widget-shell-body">
      {minimized ? (
        <WidgetLauncher onRestore={onRestore} />
      ) : (
        <>
          <WidgetShellBar
            onMinimize={onMinimize}
            onMovePointerDown={onMovePointerDown}
            {...(onMoveKeyDown ? { onMoveKeyDown } : {})}
          />
          {children}
        </>
      )}
    </div>
    {!minimized ? resizeHandle : null}
  </div>
)

export const FloatingWidgetChat = ({
  viewMode,
  initialMinimized = false,
  storageKey,
  LoadingComponent,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  framed = false,
  stageClassName
}: FloatingWidgetChatProps) => {
  const dims: WidgetDims = {
    defaultWidth: defaultWidth ?? DEFAULT_DIMS.defaultWidth,
    defaultHeight: defaultHeight ?? DEFAULT_DIMS.defaultHeight,
    minWidth: minWidth ?? DEFAULT_DIMS.minWidth,
    minHeight: minHeight ?? DEFAULT_DIMS.minHeight
  }
  const config = useBrowserShellConfig()
  const [layout, setLayout] = useState<WidgetLayout>(() => loadStandaloneLayout(storageKey, dims))
  const [hostMinimized, setHostMinimized] = useState(initialMinimized)
  const [isDragging, setIsDragging] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const dragRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(
    null
  )

  const isStandalone = viewMode === 'standalone'
  const isMinimized = isStandalone ? layout.minimized : hostMinimized
  const themeStyle = shellThemeToCssVars(config.theme)

  useEffect(() => {
    document.body.dataset.widgetViewMode = viewMode
    return () => {
      delete document.body.dataset.widgetViewMode
    }
  }, [viewMode])

  const handleStandaloneMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout
    }
    setIsDragging(true)
  }

  // Core keyboard nudge for the standalone window (C1). `resize` true adjusts
  // width/height; false moves x/y. Each change is announced via the live region.
  const nudgeLayout = (key: string, resize: boolean): boolean => {
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 }
    }
    const delta = deltas[key]
    if (!delta) {
      return false
    }
    const step = WIDGET_KEYBOARD_STEP

    setLayout((current) => {
      const next = resize
        ? clampLayout(
            {
              ...current,
              width: current.width + delta.x * step,
              height: current.height + delta.y * step
            },
            dims
          )
        : clampLayout(
            {
              ...current,
              x: current.x + delta.x * step,
              y: current.y + delta.y * step
            },
            dims
          )
      setLiveMessage(
        resize
          ? `Widget resized to ${next.width} by ${next.height} pixels.`
          : `Widget moved to ${next.x}, ${next.y}.`
      )
      return next
    })
    return true
  }

  // Grip: arrows move, Shift+arrows resize.
  const handleGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (nudgeLayout(event.key, event.shiftKey)) {
      event.preventDefault()
    }
  }

  // Resize handle: the mirror — arrows resize, Shift+arrows move.
  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (nudgeLayout(event.key, !event.shiftKey)) {
      event.preventDefault()
    }
  }

  const handleHostMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.parent === window) {
      return
    }

    setIsDragging(true)

    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const postDragEvent = (
      phase: 'start' | 'move' | 'end',
      clientX: number,
      clientY: number,
      screenX: number,
      screenY: number
    ) => {
      window.parent.postMessage(
        {
          type: 'tinytinkerer.widget.drag',
          phase,
          clientX,
          clientY,
          screenX,
          screenY
        },
        window.location.origin
      )
    }

    postDragEvent('start', event.clientX, event.clientY, event.screenX, event.screenY)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      postDragEvent(
        'move',
        moveEvent.clientX,
        moveEvent.clientY,
        moveEvent.screenX,
        moveEvent.screenY
      )
    }

    const handlePointerEnd = (endEvent: PointerEvent) => {
      setIsDragging(false)
      postDragEvent('end', endEvent.clientX, endEvent.clientY, endEvent.screenX, endEvent.screenY)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
  }

  useEffect(() => {
    if (!isStandalone) {
      return
    }

    saveStandaloneLayout(storageKey, layout)
  }, [isStandalone, layout, storageKey])

  useEffect(() => {
    if (isStandalone || window.parent === window) {
      return
    }

    window.parent.postMessage(
      {
        type: 'tinytinkerer.widget.state',
        mode: hostMinimized ? 'minimized' : 'expanded'
      },
      window.location.origin
    )
  }, [hostMinimized, isStandalone])

  useEffect(() => {
    if (!isStandalone) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (dragRef.current) {
        const { startX, startY, startLayout } = dragRef.current
        setLayout(
          clampLayout(
            {
              ...startLayout,
              x: startLayout.x + (event.clientX - startX),
              y: startLayout.y + (event.clientY - startY)
            },
            dims
          )
        )
      }

      if (resizeRef.current) {
        const { startX, startY, startLayout } = resizeRef.current
        setLayout(
          clampLayout(
            {
              ...startLayout,
              width: startLayout.width + (event.clientX - startX),
              height: startLayout.height + (event.clientY - startY)
            },
            dims
          )
        )
      }
    }

    const handlePointerUp = () => {
      dragRef.current = null
      resizeRef.current = null
      setIsDragging(false)
    }

    const handleResize = () => {
      setLayout((currentLayout) => clampLayout(currentLayout, dims))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('resize', handleResize)
    }
    // Re-bind only when the mode flips; the handlers close over the current
    // `dims`/`layout` via setLayout's updater, matching the widget's original
    // single-bind behavior.
  }, [isStandalone])

  const handleMinimize = () => {
    if (isStandalone) {
      setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: true }, dims))
      return
    }

    setHostMinimized(true)
  }

  const handleRestore = () => {
    if (isStandalone) {
      setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: false }, dims))
      return
    }

    setHostMinimized(false)
  }

  // Visually-hidden live region announcing keyboard move/resize (C1).
  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {liveMessage}
    </span>
  )

  const stageClass = (base: string) => [base, stageClassName].filter(Boolean).join(' ')

  if (!isStandalone) {
    return (
      <div className={stageClass('widget-stage widget-stage-host')} style={themeStyle}>
        {liveRegion}
        <WidgetWindow
          minimized={isMinimized}
          dragging={isDragging}
          onRestore={handleRestore}
          onMinimize={handleMinimize}
          onMovePointerDown={handleHostMovePointerDown}
          className="widget-embedded-shell"
        >
          <WidgetChatSurface LoadingComponent={LoadingComponent} framed={framed} />
        </WidgetWindow>
      </div>
    )
  }

  return (
    <div className={stageClass('widget-stage')} style={themeStyle}>
      {liveRegion}
      <WidgetWindow
        minimized={isMinimized}
        dragging={isDragging}
        onRestore={handleRestore}
        onMinimize={handleMinimize}
        onMovePointerDown={handleStandaloneMovePointerDown}
        onMoveKeyDown={handleGripKeyDown}
        style={{
          left: layout.x,
          top: layout.y,
          width: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.width,
          height: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.height
        }}
        resizeHandle={
          <button
            type="button"
            className="widget-shell-resize"
            aria-label="Resize widget. Use arrow keys to resize, Shift with arrow keys to move."
            title="Resize widget (arrow keys resize, Shift+arrows move)"
            onPointerDown={(event) => {
              resizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                startLayout: layout
              }
            }}
            onKeyDown={handleResizeKeyDown}
          />
        }
      >
        <WidgetChatSurface LoadingComponent={LoadingComponent} framed={framed} />
      </WidgetWindow>
    </div>
  )
}
