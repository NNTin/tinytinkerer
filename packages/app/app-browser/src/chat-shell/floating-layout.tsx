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
import {
  clampLayout,
  loadStandaloneLayout,
  saveStandaloneLayout,
  DEFAULT_DIMS,
  WIDGET_KEYBOARD_STEP,
  WIDGET_MINIMIZED_SIZE,
  type WidgetDims,
  type WidgetLayout
} from './layout-geometry'

// The floating, movable/resizable chat window shared by the widget app and the
// canvas app's overlay. It owns the window chrome and the standalone layout state
// machine (drag/resize/keyboard nudge/minimize/persistence). The chat body arrives
// as `children`; per-app concerns (where layout persists, boot copy) are the
// caller's — no shell is named here. When `onDock` is provided the shell bar shows
// a dock button so ChatApp can morph the window into the docked sidebar layout.

export type FloatingLayoutProps = {
  // localStorage key the layout persists under (per app).
  storageKey: string
  // Start minimized.
  initialMinimized?: boolean
  // Window sizing overrides; defaults match the widget's historical sizes.
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  // Extra class on the outer stage — the canvas overlay uses it to make the stage
  // click-through (pointer-events: none) so the whiteboard beneath stays usable
  // while the floating shell (pointer-events: auto) remains interactive.
  stageClassName?: string
  // When set, the shell bar shows a "dock" button that morphs into the sidebar.
  onDock?: () => void
  // The chat body (e.g. FloatingChatSurface).
  children: ReactNode
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
  onDock,
  onMovePointerDown,
  onMoveKeyDown
}: {
  onMinimize: () => void
  onDock?: () => void
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
    {onDock ? (
      <button
        type="button"
        className="widget-shell-dock"
        aria-label="Dock to sidebar"
        title="Dock to sidebar"
        onClick={onDock}
      >
        <span aria-hidden="true" />
      </button>
    ) : null}
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
  onDock,
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
  onDock?: () => void
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
            {...(onDock ? { onDock } : {})}
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

export const FloatingLayout = ({
  storageKey,
  initialMinimized = false,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  stageClassName,
  onDock,
  children
}: FloatingLayoutProps) => {
  const dims: WidgetDims = {
    defaultWidth: defaultWidth ?? DEFAULT_DIMS.defaultWidth,
    defaultHeight: defaultHeight ?? DEFAULT_DIMS.defaultHeight,
    minWidth: minWidth ?? DEFAULT_DIMS.minWidth,
    minHeight: minHeight ?? DEFAULT_DIMS.minHeight
  }
  const config = useBrowserShellConfig()
  const [layout, setLayout] = useState<WidgetLayout>(() =>
    clampLayout({ ...loadStandaloneLayout(storageKey, dims), minimized: initialMinimized }, dims)
  )
  const [isDragging, setIsDragging] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const dragRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(
    null
  )

  const isMinimized = layout.minimized
  const themeStyle = shellThemeToCssVars(config.theme)

  useEffect(() => {
    document.body.dataset.widgetViewMode = 'standalone'
    return () => {
      delete document.body.dataset.widgetViewMode
    }
  }, [])

  const handleMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
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

  useEffect(() => {
    saveStandaloneLayout(storageKey, layout)
  }, [layout, storageKey])

  useEffect(() => {
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
    // Bind once; the handlers close over the current `dims`/`layout` via setLayout's
    // updater, matching the widget's original single-bind behavior.
  }, [])

  const handleMinimize = () => {
    setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: true }, dims))
  }

  const handleRestore = () => {
    setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: false }, dims))
  }

  // Visually-hidden live region announcing keyboard move/resize (C1).
  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {liveMessage}
    </span>
  )

  const stageClass = ['widget-stage', stageClassName].filter(Boolean).join(' ')

  return (
    <div className={stageClass} style={themeStyle}>
      {liveRegion}
      <WidgetWindow
        minimized={isMinimized}
        dragging={isDragging}
        onRestore={handleRestore}
        onMinimize={handleMinimize}
        {...(onDock ? { onDock } : {})}
        onMovePointerDown={handleMovePointerDown}
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
        {children}
      </WidgetWindow>
    </div>
  )
}
