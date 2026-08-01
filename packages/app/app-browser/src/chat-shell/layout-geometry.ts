// Shared geometry + persistence helpers for the chat-shell layouts. The floating
// layout (free x/y/width/height window) and the sidebar layout (single-axis docked
// panel) both clamp to the viewport and persist under a localStorage key. This is
// the single home for that math — it used to live inline in floating-widget-chat
// and, hand-rolled a second time, in the host compositor's vanilla JS.

export const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
// Keyboard nudge step for moving/resizing the standalone floating window (C1).
export const WIDGET_KEYBOARD_STEP = 16

// Unit x/y deltas for the arrow keys — shared by the floating window's keyboard
// nudge and the docked splitter's keyboard resize (#356).
export const ARROW_KEY_DELTAS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }
}

export const DEFAULT_DIMS = {
  defaultWidth: 400,
  defaultHeight: 680,
  minWidth: 320,
  minHeight: 420
}

export type WidgetDims = typeof DEFAULT_DIMS

export type WidgetLayout = {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/**
 * The largest box that fits an axis, and the margin it may keep.
 *
 * `minWidth`/`minHeight` are a comfort floor, not a guarantee the viewport can
 * honour: a 320 CSS-pixel phone cannot show a 320px-minimum panel AND a 24px
 * margin on both sides. Preferring the minimum there put the panel's right edge
 * 24px past the viewport, taking the resize handle and part of the window
 * chrome off-screen with no way to scroll to them.
 *
 * So when the two constraints cannot both hold, FITTING WINS: the margin
 * collapses first, and the box then shrinks below its configured minimum rather
 * than overflowing. A panel narrower than its designed minimum is awkward; one
 * whose controls are off-screen is unusable.
 */
const fitAxis = (extent: number, minimum: number): { size: number; margin: number } => {
  const withMargin = extent - WIDGET_SAFE_MARGIN * 2
  if (withMargin >= minimum) {
    return { size: withMargin, margin: WIDGET_SAFE_MARGIN }
  }
  if (extent >= minimum) {
    // The minimum still fits, but not with the full margin on both sides.
    return { size: minimum, margin: Math.max(0, Math.floor((extent - minimum) / 2)) }
  }
  return { size: extent, margin: 0 }
}

export const clampLayout = (layout: WidgetLayout, dims: WidgetDims): WidgetLayout => {
  const horizontal = fitAxis(window.innerWidth, dims.minWidth)
  const vertical = fitAxis(window.innerHeight, dims.minHeight)

  const width = clamp(
    Math.round(layout.width),
    Math.min(dims.minWidth, horizontal.size),
    horizontal.size
  )
  const height = clamp(
    Math.round(layout.height),
    Math.min(dims.minHeight, vertical.size),
    vertical.size
  )
  const boxWidth = layout.minimized ? Math.min(WIDGET_MINIMIZED_SIZE, horizontal.size) : width
  const boxHeight = layout.minimized ? Math.min(WIDGET_MINIMIZED_SIZE, vertical.size) : height

  return {
    ...layout,
    width,
    height,
    x: clamp(
      Math.round(layout.x),
      horizontal.margin,
      Math.max(horizontal.margin, window.innerWidth - boxWidth - horizontal.margin)
    ),
    y: clamp(
      Math.round(layout.y),
      vertical.margin,
      Math.max(vertical.margin, window.innerHeight - boxHeight - vertical.margin)
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

export const loadStandaloneLayout = (storageKey: string, dims: WidgetDims): WidgetLayout => {
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

export const saveStandaloneLayout = (storageKey: string, layout: WidgetLayout): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(layout))
}

// Single-axis clamp for a docked panel's size (width for a left/right dock, height
// for a top/bottom dock): at least `min`, at most `maxFraction` of the axis `extent`
// (so the docked split never swallows the page). `extent` is the viewport size along
// the resize axis (innerWidth for horizontal docks, innerHeight for vertical ones).
export const clampSize = (
  size: number,
  extent: number,
  { min, maxFraction }: { min: number; maxFraction: number }
): number => clamp(Math.round(size), min, Math.max(min, Math.round(extent * maxFraction)))

// === Snap-to-dock geometry (issue #324) ===
//
// While the floating widget is dragged, the shell arms a "snap" preview when the
// pointer nears a viewport edge; releasing there morphs the widget into the docked
// "web mode" (SidebarLayout) filling that edge. The zone detection + preview rect
// math live here so the drag surface (floating-layout) and the docked layout stay
// thin and the behavior is unit-testable without a DOM.

export type SnapEdge = 'top' | 'bottom' | 'left' | 'right'

export type Viewport = { width: number; height: number }

export type PreviewRect = { left: number; top: number; width: number; height: number }

// How close (px) the pointer must come to a viewport edge during a drag to arm the
// snap preview for that edge.
export const SNAP_THRESHOLD = 56

// Fraction of the viewport the docked web-mode split fills in the snap preview.
export const SNAP_PREVIEW_FRACTION = 0.5

// Minimum net pointer travel (px) toward a viewport edge, since drag start, for a
// snap dock to count as deliberate (#336). Mere proximity is not intent: the grip of
// a widget parked at the safe margin always sits inside a snap zone (SNAP_THRESHOLD
// 56 > WIDGET_SAFE_MARGIN 24), so a click or a slide along the edge must not dock.
export const SNAP_INTENT_TRAVEL = 24

export const isDeliberateSnap = (
  start: { x: number; y: number },
  point: { x: number; y: number },
  edge: SnapEdge,
  travel: number = SNAP_INTENT_TRAVEL
): boolean => {
  switch (edge) {
    case 'top':
      return start.y - point.y >= travel
    case 'bottom':
      return point.y - start.y >= travel
    case 'left':
      return start.x - point.x >= travel
    case 'right':
      return point.x - start.x >= travel
  }
}

// Which edge (if any) a pointer at `point` is within `threshold` px of. At a corner
// the nearest edge wins, so a diagonal approach resolves to a single deterministic
// edge rather than flickering between two.
export const detectSnapEdge = (
  point: { x: number; y: number },
  viewport: Viewport,
  threshold: number = SNAP_THRESHOLD
): SnapEdge | null => {
  const distances: ReadonlyArray<readonly [SnapEdge, number]> = [
    ['top', point.y],
    ['bottom', viewport.height - point.y],
    ['left', point.x],
    ['right', viewport.width - point.x]
  ]
  let best: SnapEdge | null = null
  let bestDistance = threshold
  for (const [edge, distance] of distances) {
    if (distance < bestDistance) {
      bestDistance = distance
      best = edge
    }
  }
  return best
}

// The viewport-pixel region the docked web mode would fill for `edge`. Drives the
// ghost preview overlay while dragging and mirrors where SidebarLayout docks.
export const snapPreviewRect = (
  edge: SnapEdge,
  viewport: Viewport,
  fraction: number = SNAP_PREVIEW_FRACTION
): PreviewRect => {
  const splitWidth = Math.round(viewport.width * fraction)
  const splitHeight = Math.round(viewport.height * fraction)
  switch (edge) {
    case 'left':
      return { left: 0, top: 0, width: splitWidth, height: viewport.height }
    case 'right':
      return {
        left: viewport.width - splitWidth,
        top: 0,
        width: splitWidth,
        height: viewport.height
      }
    case 'top':
      return { left: 0, top: 0, width: viewport.width, height: splitHeight }
    case 'bottom':
      return {
        left: 0,
        top: viewport.height - splitHeight,
        width: viewport.width,
        height: splitHeight
      }
  }
}

// Top/bottom docks resize along the vertical axis (height); left/right along the
// horizontal axis (width). Used by the docked layout's resize math + persistence.
export const isVerticalEdge = (edge: SnapEdge): boolean => edge === 'top' || edge === 'bottom'

// Signed size delta (px) a keyboard event applies to a docked panel, per the WAI-ARIA
// window-splitter pattern: arrows move the divider, and moving it toward the viewport
// centre grows the panel (#356). Null for keys off the dock's resize axis.
export const dockedResizeDelta = (
  key: string,
  edge: SnapEdge,
  step: number = WIDGET_KEYBOARD_STEP
): number | null => {
  const delta = ARROW_KEY_DELTAS[key]
  if (!delta) return null
  const along = isVerticalEdge(edge) ? delta.y : delta.x
  if (along === 0) return null
  const grows = edge === 'right' || edge === 'bottom' ? -along : along
  return grows * step
}

// Generic JSON localStorage load/save used by layouts whose persisted shape is not
// a WidgetLayout (e.g. the sidebar's { width, side }). `parse` validates/normalizes
// the raw parsed value and returns the fallback on any bad shape.
export const loadPersisted = <T>(
  storageKey: string,
  parse: (raw: unknown) => T | null,
  fallback: T
): T => {
  const stored = window.localStorage.getItem(storageKey)
  if (!stored) {
    return fallback
  }
  try {
    const value = parse(JSON.parse(stored))
    return value ?? fallback
  } catch {
    return fallback
  }
}

export const savePersisted = <T>(storageKey: string, value: T): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(value))
}

// Merge `patch` into the JSON object persisted under `storageKey`, preserving keys the
// caller doesn't own — e.g. the sidebar's cross-axis size, so docking top/bottom never
// erases the stored width and vice versa (#335). A missing or non-object stored value
// is replaced by the patch alone.
export const updatePersisted = (storageKey: string, patch: Record<string, unknown>): void => {
  const existing = loadPersisted<Record<string, unknown>>(
    storageKey,
    (raw) =>
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null,
    {}
  )
  savePersisted(storageKey, { ...existing, ...patch })
}
