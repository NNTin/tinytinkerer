import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBrowserShellConfig } from '../hooks'
import { shellThemeToCssVars } from '../shell-theme'
import {
  clampSize,
  isVerticalEdge,
  loadPersisted,
  savePersisted,
  type SnapEdge
} from './layout-geometry'

// The docked chat layout: a full-height (or full-width) panel that holds the shared
// chat body. On the /web and /mobile endpoints it fills the viewport (children center
// via their own max-width). When `resizable` it becomes a single-axis-resizable panel
// docked to `edge` (the "web mode" split #324 builds on) — left/right resize width,
// top/bottom resize height. When `onUndock` is provided it shows a float button so
// ChatApp can morph it back into the floating window.

const DEFAULT_SIDEBAR_WIDTH = 420
const DEFAULT_MIN_WIDTH = 320
const DEFAULT_MAX_FRACTION = 0.6

export type SidebarLayoutProps = {
  // localStorage key the panel size persists under (per app). Only used when
  // `resizable`.
  storageKey: string
  sizeVariant?: 'comfortable' | 'mobile'
  // Legacy left/right prop; superseded by `edge` when both are given. Kept so
  // callers that only ever dock to a side keep working unchanged.
  side?: 'left' | 'right'
  // Which viewport edge to dock to (top/bottom/left/right). Defaults to `side`.
  edge?: SnapEdge
  // Render as a fixed-size docked panel with a resize handle. Off by default so the
  // full-page endpoints keep their centered full-viewport presentation. The mobile
  // variant ignores this (a phone panel is always full-bleed).
  resizable?: boolean
  // Fill the parent height (`h-full`) instead of the viewport — used by the root
  // composition where each pane is a bounded region, not the whole screen.
  fill?: boolean
  defaultWidth?: number
  minWidth?: number
  maxFraction?: number
  // When set, shows a float/undock button that morphs back to the floating layout.
  onUndock?: () => void
  children: ReactNode
}

export const SidebarLayout = ({
  storageKey,
  sizeVariant = 'comfortable',
  side = 'right',
  edge,
  resizable = false,
  fill = false,
  defaultWidth = DEFAULT_SIDEBAR_WIDTH,
  minWidth = DEFAULT_MIN_WIDTH,
  maxFraction = DEFAULT_MAX_FRACTION,
  onUndock,
  children
}: SidebarLayoutProps) => {
  const config = useBrowserShellConfig()
  const themeStyle = shellThemeToCssVars(config.theme)
  const dockEdge: SnapEdge = edge ?? side
  const vertical = isVerticalEdge(dockEdge)
  const isDocked = resizable && sizeVariant !== 'mobile'

  // Top/bottom docks persist a `{ height }`, left/right a `{ width }`, so a widget
  // that was docked to a side keeps its size when re-docked to that same side.
  const sizeKey = vertical ? 'height' : 'width'
  const axisExtent = () => (vertical ? window.innerHeight : window.innerWidth)

  const parseSize = (raw: unknown): number | null => {
    if (typeof raw !== 'object' || raw === null) return null
    const value = (raw as Record<string, unknown>)[sizeKey]
    return typeof value === 'number' ? value : null
  }

  const [size, setSize] = useState<number>(() =>
    isDocked
      ? clampSize(loadPersisted(storageKey, parseSize, defaultWidth), axisExtent(), {
          min: minWidth,
          maxFraction
        })
      : defaultWidth
  )
  const resizeRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null)

  useEffect(() => {
    if (!isDocked) return
    savePersisted(storageKey, { [sizeKey]: size })
  }, [isDocked, storageKey, sizeKey, size])

  useEffect(() => {
    if (!isDocked) return

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      const { startX, startY, startSize } = resizeRef.current
      // Dragging the inner edge grows the panel toward the viewport centre: a
      // right/bottom-docked panel grows as the pointer moves in (left/up), a
      // left/top-docked panel grows as it moves the other way.
      const delta =
        dockEdge === 'right'
          ? startX - event.clientX
          : dockEdge === 'left'
            ? event.clientX - startX
            : dockEdge === 'bottom'
              ? startY - event.clientY
              : event.clientY - startY
      setSize(clampSize(startSize + delta, axisExtent(), { min: minWidth, maxFraction }))
    }
    const handlePointerUp = () => {
      resizeRef.current = null
    }
    const handleResize = () => {
      setSize((current) => clampSize(current, axisExtent(), { min: minWidth, maxFraction }))
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
  }, [isDocked, dockEdge, minWidth, maxFraction, vertical])

  const heightClass = fill ? 'h-full' : sizeVariant === 'mobile' ? 'h-[100dvh]' : 'h-screen'

  const undockButton = onUndock ? (
    <button
      type="button"
      className="sidebar-undock"
      aria-label="Float chat"
      title="Float chat"
      onClick={onUndock}
    >
      <span aria-hidden="true" />
    </button>
  ) : null

  if (!isDocked) {
    return (
      <div className={`sidebar-stage relative ${heightClass} w-full`} style={themeStyle}>
        {undockButton}
        {children}
      </div>
    )
  }

  // Alignment of the panel within the stage, per edge. Horizontal docks are a row
  // pinned left/right; vertical docks are a column pinned top/bottom.
  const stageAlign = vertical
    ? `flex-col ${dockEdge === 'top' ? 'justify-start' : 'justify-end'}`
    : dockEdge === 'right'
      ? 'justify-end'
      : 'justify-start'

  const resizeEdgeClass = `sidebar-resize-${dockEdge}`

  return (
    <div
      className={`sidebar-stage relative flex ${heightClass} w-full ${stageAlign}`}
      style={themeStyle}
    >
      <div
        className={`sidebar-panel relative ${vertical ? 'w-full' : 'h-full'}`}
        data-edge={dockEdge}
        style={vertical ? { height: size } : { width: size }}
      >
        <button
          type="button"
          className={`sidebar-resize ${resizeEdgeClass}`}
          aria-label="Resize sidebar"
          title="Resize sidebar"
          onPointerDown={(event) => {
            resizeRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              startSize: size
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // jsdom / unsupported: window listeners still receive the events.
            }
          }}
        />
        {undockButton}
        {children}
      </div>
    </div>
  )
}
