import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBrowserShellConfig } from '../hooks'
import { shellThemeToCssVars } from '../shell-theme'
import { clampWidth, loadPersisted, savePersisted } from './layout-geometry'

// The docked chat layout: a full-height panel that holds the shared chat body. On
// the /web and /mobile endpoints it fills the viewport (children center via their
// own max-width). When `resizable` it becomes a single-axis-resizable panel docked
// to `side` (the "web mode" split that #324 builds on). When `onUndock` is provided
// it shows a float button so ChatApp can morph it back into the floating window.

const DEFAULT_SIDEBAR_WIDTH = 420
const DEFAULT_MIN_WIDTH = 320
const DEFAULT_MAX_FRACTION = 0.6

export type SidebarLayoutProps = {
  // localStorage key the panel width persists under (per app). Only used when
  // `resizable`.
  storageKey: string
  sizeVariant?: 'comfortable' | 'mobile'
  side?: 'left' | 'right'
  // Render as a fixed-width docked panel with a resize handle. Off by default so
  // the full-page endpoints keep their centered full-viewport presentation. The
  // mobile variant ignores this (a phone panel is always full-bleed).
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

const parseWidth = (raw: unknown): number | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const width = (raw as Record<string, unknown>).width
  return typeof width === 'number' ? width : null
}

export const SidebarLayout = ({
  storageKey,
  sizeVariant = 'comfortable',
  side = 'right',
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
  const isDocked = resizable && sizeVariant !== 'mobile'

  const [width, setWidth] = useState<number>(() =>
    isDocked
      ? clampWidth(loadPersisted(storageKey, parseWidth, defaultWidth), { minWidth, maxFraction })
      : defaultWidth
  )
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!isDocked) return
    savePersisted(storageKey, { width })
  }, [isDocked, storageKey, width])

  useEffect(() => {
    if (!isDocked) return

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      const { startX, startWidth } = resizeRef.current
      // Dragging the inner edge: a right-docked panel grows as the pointer moves
      // left; a left-docked panel grows as it moves right.
      const delta = side === 'right' ? startX - event.clientX : event.clientX - startX
      setWidth(clampWidth(startWidth + delta, { minWidth, maxFraction }))
    }
    const handlePointerUp = () => {
      resizeRef.current = null
    }
    const handleResize = () => {
      setWidth((current) => clampWidth(current, { minWidth, maxFraction }))
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
  }, [isDocked, side, minWidth, maxFraction])

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

  return (
    <div
      className={`sidebar-stage relative flex ${heightClass} w-full ${
        side === 'right' ? 'justify-end' : 'justify-start'
      }`}
      style={themeStyle}
    >
      <div className="sidebar-panel relative h-full" style={{ width }}>
        <button
          type="button"
          className={`sidebar-resize ${side === 'right' ? 'sidebar-resize-left' : 'sidebar-resize-right'}`}
          aria-label="Resize sidebar"
          title="Resize sidebar"
          onPointerDown={(event) => {
            resizeRef.current = { startX: event.clientX, startWidth: width }
          }}
        />
        {undockButton}
        {children}
      </div>
    </div>
  )
}
