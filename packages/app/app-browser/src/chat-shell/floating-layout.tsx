import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { TINYTINKERER_BRAND_ASSET_URLS } from '@tinytinkerer/brand-assets'
import { useBrowserShellConfig } from '../hooks'
import { shellThemeToCssVars } from '../shell-theme'
import {
  clampLayout,
  detectSnapEdge,
  isDeliberateSnap,
  loadStandaloneLayout,
  saveStandaloneLayout,
  snapPreviewRect,
  ARROW_KEY_DELTAS,
  DEFAULT_DIMS,
  WIDGET_KEYBOARD_STEP,
  WIDGET_MINIMIZED_SIZE,
  type SnapEdge,
  type WidgetDims,
  type WidgetLayout
} from './layout-geometry'
import { usePointerDrag } from './use-pointer-drag'

// The floating, movable/resizable chat window shared by the widget app and the
// canvas app's overlay. It owns the window chrome and the standalone layout state
// machine (drag/resize/keyboard nudge and geometry persistence). The chat body
// arrives as `children`; per-app concerns (where layout persists, boot copy) are
// the caller's — no shell is named here. When `onDock` is provided the shell bar
// shows a dock button, and dragging the window near a viewport edge arms a snap
// preview so releasing there morphs the window into the docked sidebar
// ("web mode", #324).

// Below this pointer travel (px) a drag counts as a click. Used so the minimized
// launcher can be BOTH a drag handle and a restore button (#323): a small movement
// restores, a real drag repositions without restoring.
const DRAG_CLICK_THRESHOLD = 5

export type FloatingLayoutProps = {
  // localStorage key the layout persists under (per app).
  storageKey: string
  // Start minimized for a direct, uncontrolled layout consumer. ChatApp always
  // controls this from its complete ChatPresentation record.
  initialMinimized?: boolean
  // Controlled minimized state. The layout never persists this value:
  // presentation belongs to ChatApp/a host; this component persists geometry.
  minimized?: boolean
  // Fired whenever the reader minimizes or restores, in both modes.
  onMinimizedChange?: (minimized: boolean) => void
  // Move focus into the panel when this layout FIRST mounts unminimized. Off by
  // default: a shell that mounts its widget during page load must not steal
  // focus. An embedder that mounts it in response to a reader's click should,
  // since that click is the request to start typing.
  focusPanelOnMount?: boolean
  // Window sizing overrides; defaults match the widget's historical sizes.
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  // Extra class on the outer stage — the canvas overlay uses it to make the stage
  // click-through (pointer-events: none) so the whiteboard beneath stays usable
  // while the floating shell (pointer-events: auto) remains interactive.
  stageClassName?: string
  // When set, the shell bar shows a "dock" button (docks to the caller's side) and
  // dragging near a viewport edge morphs into that edge's docked split. Receives the
  // released snap edge, or no argument for the plain dock button.
  onDock?: (edge?: SnapEdge) => void
  // The chat body (e.g. FloatingChatSurface).
  children: ReactNode
}

const WidgetLauncher = ({
  onRestore,
  onDragPointerDown,
  buttonRef
}: {
  onRestore: () => void
  onDragPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  buttonRef: RefObject<HTMLButtonElement | null>
}) => (
  // No padding: the launcher FILLS the minimized shell, which is
  // `WIDGET_MINIMIZED_SIZE` — the same 4rem the shared primitive sizes it to. It
  // used to sit inside `p-2`, which flex-shrank the 4rem button to 48px, so the
  // control a reader pressed on /widget was visibly smaller than the identical
  // one a host draws before the runtime boots. The parity e2e measures both.
  <div className="flex h-full items-center justify-center">
    <button
      ref={buttonRef}
      type="button"
      onClick={onRestore}
      onPointerDown={onDragPointerDown}
      aria-label="Restore widget"
      title="Drag to move, click to restore"
      // `tt-embed-launcher` is the product's launcher chrome, shared with the
      // cold launcher a host draws before this component exists (issue #480
      // re-review, finding 4 — see launcher.css). `widget-launcher` adds only
      // what is true of the MOUNTED one: it doubles as a drag handle.
      className="widget-launcher tt-embed-launcher"
    >
      <img src={TINYTINKERER_BRAND_ASSET_URLS.icon192} alt="" className="tt-embed-launcher__icon" />
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
  onLauncherPointerDown,
  onMoveKeyDown,
  children,
  resizeHandle,
  className,
  style,
  launcherRef,
  bodyRef
}: {
  minimized: boolean
  dragging: boolean
  onRestore: () => void
  onMinimize: () => void
  onDock?: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onLauncherPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  children: ReactNode
  resizeHandle?: ReactNode
  className?: string
  style?: CSSProperties
  launcherRef: RefObject<HTMLButtonElement | null>
  bodyRef: RefObject<HTMLDivElement | null>
}) => (
  <div
    className={['widget-floating-shell', className].filter(Boolean).join(' ')}
    data-dragging={dragging ? 'true' : 'false'}
    data-minimized={minimized ? 'true' : 'false'}
    style={style}
  >
    {/* `tabIndex={-1}` so restoring has somewhere to put focus on a body that
        happens to contain no focusable control yet (a still-booting chat). It is
        programmatic only — never in the tab order. */}
    <div className="widget-shell-body" ref={bodyRef} tabIndex={-1}>
      {minimized ? (
        <WidgetLauncher
          onRestore={onRestore}
          onDragPointerDown={onLauncherPointerDown}
          buttonRef={launcherRef}
        />
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

type DragState = {
  startX: number
  startY: number
  startLayout: WidgetLayout
  // Whether the pointer has travelled past the click threshold.
  moved: boolean
  // Drag started from the minimized launcher (which doubles as a restore button).
  fromLauncher: boolean
  // The live snap edge, mutated during the drag (mirrors `moved`) so the pointerup
  // handler can read the final value without a separate ref.
  snapEdge: SnapEdge | null
}

export const FloatingLayout = ({
  storageKey,
  initialMinimized = false,
  minimized: controlledMinimized,
  onMinimizedChange,
  focusPanelOnMount = false,
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
  const isControlled = controlledMinimized !== undefined
  const [uncontrolledMinimized, setUncontrolledMinimized] = useState(initialMinimized ?? false)
  const isMinimized = controlledMinimized ?? uncontrolledMinimized
  const config = useBrowserShellConfig()
  const [layout, setLayout] = useState<WidgetLayout>(() =>
    loadStandaloneLayout(storageKey, dims, isMinimized)
  )
  const [isDragging, setIsDragging] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const [snapEdge, setSnapEdge] = useState<SnapEdge | null>(null)
  // One-shot flag that suppresses the launcher's restore click after a real drag (so
  // dragging the minimized widget never restores).
  const suppressLauncherClickRef = useRef(false)
  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // A presentation change alters the box used to clamp x/y. Adopt it during
  // render (React's documented derived-state pattern) rather than painting one
  // frame with the full panel's bounds applied to a 64px launcher, or vice versa.
  const [lastControlledMinimized, setLastControlledMinimized] = useState(controlledMinimized)
  if (isControlled && controlledMinimized !== lastControlledMinimized) {
    setLastControlledMinimized(controlledMinimized)
    setLayout((current) => clampLayout(current, dims, controlledMinimized))
  }

  const themeStyle = shellThemeToCssVars(config.theme)

  // The one place minimized/restored changes, in both modes. Uncontrolled keeps
  // the state here; controlled only reports, and the caller's next prop value
  // comes back through the render-phase adoption above.
  const changeMinimized = (next: boolean): void => {
    if (!isControlled) {
      setUncontrolledMinimized(next)
      setLayout((current) => clampLayout(current, dims, next))
    }
    onMinimizedChange?.(next)
  }

  useEffect(() => {
    document.body.dataset.widgetViewMode = 'standalone'
    return () => {
      delete document.body.dataset.widgetViewMode
    }
  }, [])

  const { begin: beginDragGesture } = usePointerDrag<DragState>(true, {
    onMove: (drag, event) => {
      if (
        !drag.moved &&
        (Math.abs(event.clientX - drag.startX) > DRAG_CLICK_THRESHOLD ||
          Math.abs(event.clientY - drag.startY) > DRAG_CLICK_THRESHOLD)
      ) {
        drag.moved = true
      }
      setLayout(
        clampLayout(
          {
            ...drag.startLayout,
            x: drag.startLayout.x + (event.clientX - drag.startX),
            y: drag.startLayout.y + (event.clientY - drag.startY)
          },
          dims,
          drag.fromLauncher
        )
      )

      // Snap preview only for a normal (non-minimized) window drag when docking is
      // offered — dragging the minimized launcher just repositions it. A zone hit
      // arms only after deliberate travel toward that edge (#336): proximity alone
      // would dock on a click or an along-the-edge slide.
      const candidate =
        !drag.fromLauncher && onDock
          ? detectSnapEdge(
              { x: event.clientX, y: event.clientY },
              { width: window.innerWidth, height: window.innerHeight }
            )
          : null
      const edge =
        candidate &&
        isDeliberateSnap(
          { x: drag.startX, y: drag.startY },
          { x: event.clientX, y: event.clientY },
          candidate
        )
          ? candidate
          : null
      if (edge !== drag.snapEdge) {
        drag.snapEdge = edge
        setSnapEdge(edge)
      }
    },
    onEnd: (drag) => {
      setIsDragging(false)
      setSnapEdge(null)

      // Released in a snap zone → morph into the docked web mode for that edge. A
      // sub-threshold press is a click, never a dock (#336).
      if (!drag.fromLauncher && drag.moved && drag.snapEdge && onDock) {
        onDock(drag.snapEdge)
        return
      }
      // A dragged launcher must not fire its restore click on release.
      if (drag.fromLauncher && drag.moved) {
        suppressLauncherClickRef.current = true
      }
    },
    // A browser-aborted gesture (touch takeover, pointer reclaim) reverts to the
    // pre-drag state instead of committing the most consequential outcome (#336) —
    // in particular it must never dock.
    onCancel: (drag) => {
      setIsDragging(false)
      setSnapEdge(null)
      setLayout(clampLayout(drag.startLayout, dims, drag.fromLauncher))
    }
  })

  const { begin: beginResizeGesture } = usePointerDrag<{
    startX: number
    startY: number
    startLayout: WidgetLayout
  }>(true, {
    onMove: (start, event) =>
      setLayout(
        clampLayout(
          {
            ...start.startLayout,
            width: start.startLayout.width + (event.clientX - start.startX),
            height: start.startLayout.height + (event.clientY - start.startY)
          },
          dims,
          false
        )
      ),
    onCancel: (start) => setLayout(clampLayout(start.startLayout, dims, false))
  })

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, fromLauncher: boolean) => {
    // Capture the pointer so the drag keeps tracking even when the cursor leaves the
    // window or other content beneath it, or past
    // the viewport edge (#323: "moving the widget from below to top loses the drag").
    beginDragGesture(event, {
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout,
      moved: false,
      fromLauncher,
      snapEdge: null
    })
    setIsDragging(true)
  }

  const handleGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginDrag(event, false)
  }

  const handleLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    beginDrag(event, true)
  }

  const handleMinimize = () => {
    changeMinimized(true)
  }

  const handleRestore = () => {
    changeMinimized(false)
  }

  const handleLauncherClick = () => {
    // A real drag just ended — swallow the trailing click so the widget stays put
    // instead of restoring. A plain click (or keyboard activation) restores.
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false
      return
    }
    handleRestore()
  }

  // Core keyboard nudge for the standalone window (C1). `resize` true adjusts
  // width/height; false moves x/y. Each change is announced via the live region.
  const nudgeLayout = (key: string, resize: boolean): boolean => {
    const delta = ARROW_KEY_DELTAS[key]
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
            dims,
            isMinimized
          )
        : clampLayout(
            {
              ...current,
              x: current.x + delta.x * step,
              y: current.y + delta.y * step
            },
            dims,
            isMinimized
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

  // Focus follows the widget's own state change, never a page load (C1, issue
  // #480). Minimizing hands focus to the launcher that replaced the panel;
  // restoring hands it to the composer, so a reader who reopened the widget can
  // type. Both are cases where the element the reader was using has just left
  // the document, and leaving focus on `<body>` there would drop a keyboard user
  // back at the top of the documentation.
  //
  // This layout is non-modal by design: nothing here traps focus, so Tab always
  // leads back out into the host page.
  const previousMinimizedRef = useRef<boolean | null>(null)
  useEffect(() => {
    const previous = previousMinimizedRef.current
    previousMinimizedRef.current = isMinimized
    // First commit: only an explicit `focusPanelOnMount` may move focus, because
    // every product shell mounts this during page load.
    const isFirstCommit = previous === null
    if (isFirstCommit ? !(focusPanelOnMount && !isMinimized) : previous === isMinimized) {
      return undefined
    }
    if (isMinimized) {
      launcherRef.current?.focus()
      return undefined
    }

    const body = bodyRef.current
    const focusComposer = (): boolean => {
      const composer = body?.querySelector('textarea')
      if (!composer) {
        return false
      }
      composer.focus()
      return true
    }
    if (focusComposer() || !body) {
      return undefined
    }

    // No composer yet. On a COLD activation that is the normal case rather than
    // an edge one: the chat body renders its loading screen instead of the
    // conversation until the session has booted, so at this commit the panel
    // contains no focusable control at all.
    //
    // Park focus on the panel first — `widget-shell-body` is programmatically
    // focusable for exactly this — so a keyboard reader is inside the widget
    // rather than back at the top of the host page, then hand it to the composer
    // the moment one appears.
    body.focus()
    const observer = new MutationObserver(() => {
      // Only while focus is still inside the panel. A reader who clicked away
      // during the boot has moved on, and yanking focus back a second later
      // would be worse than never having moved it.
      if (!body.contains(document.activeElement)) {
        observer.disconnect()
        return
      }
      if (focusComposer()) {
        observer.disconnect()
      }
    })
    observer.observe(body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [isMinimized, focusPanelOnMount])

  useEffect(() => {
    saveStandaloneLayout(storageKey, layout)
  }, [layout, storageKey])

  // Viewport resize only; drag/resize gestures are owned by usePointerDrag above.
  // The handler closes over the current `dims` via setLayout's updater, matching the
  // widget's original single-bind behavior.
  useEffect(() => {
    const handleResize = () => {
      setLayout((currentLayout) => clampLayout(currentLayout, dims, isMinimized))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [isMinimized])

  // Visually-hidden live region announcing keyboard move/resize (C1).
  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {liveMessage}
    </span>
  )

  const stageClass = ['widget-stage', stageClassName].filter(Boolean).join(' ')

  const snapPreview = snapEdge
    ? (() => {
        const rect = snapPreviewRect(snapEdge, {
          width: window.innerWidth,
          height: window.innerHeight
        })
        return (
          <div
            className="widget-snap-preview"
            data-edge={snapEdge}
            aria-hidden="true"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        )
      })()
    : null

  return (
    <div className={stageClass} style={themeStyle}>
      {liveRegion}
      {snapPreview}
      <WidgetWindow
        minimized={isMinimized}
        dragging={isDragging}
        onRestore={handleLauncherClick}
        onMinimize={handleMinimize}
        {...(onDock ? { onDock: () => onDock() } : {})}
        onMovePointerDown={handleGripPointerDown}
        onLauncherPointerDown={handleLauncherPointerDown}
        onMoveKeyDown={handleGripKeyDown}
        launcherRef={launcherRef}
        bodyRef={bodyRef}
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
            onPointerDown={(event) =>
              beginResizeGesture(event, {
                startX: event.clientX,
                startY: event.clientY,
                startLayout: layout
              })
            }
            onKeyDown={handleResizeKeyDown}
          />
        }
      >
        {children}
      </WidgetWindow>
    </div>
  )
}
