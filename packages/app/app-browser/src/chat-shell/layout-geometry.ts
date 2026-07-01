// Shared geometry + persistence helpers for the chat-shell layouts. The floating
// layout (free x/y/width/height window) and the sidebar layout (single-axis docked
// panel) both clamp to the viewport and persist under a localStorage key. This is
// the single home for that math — it used to live inline in floating-widget-chat
// and, hand-rolled a second time, in the host compositor's vanilla JS.

export const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
// Keyboard nudge step for moving/resizing the standalone floating window (C1).
export const WIDGET_KEYBOARD_STEP = 16

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

export const clampLayout = (layout: WidgetLayout, dims: WidgetDims): WidgetLayout => {
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

// Single-axis clamp for the docked sidebar panel width: at least `minWidth`, at
// most `maxFraction` of the viewport (so the docked panel never swallows the page).
export const clampWidth = (
  width: number,
  { minWidth, maxFraction }: { minWidth: number; maxFraction: number }
): number =>
  clamp(
    Math.round(width),
    minWidth,
    Math.max(minWidth, Math.round(window.innerWidth * maxFraction))
  )

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
