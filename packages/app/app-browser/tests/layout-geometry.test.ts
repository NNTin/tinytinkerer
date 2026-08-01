// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampLayout,
  clampSize,
  detectSnapEdge,
  dockedResizeDelta,
  isDeliberateSnap,
  isVerticalEdge,
  snapPreviewRect,
  updatePersisted,
  SNAP_INTENT_TRAVEL,
  SNAP_THRESHOLD,
  WIDGET_KEYBOARD_STEP,
  WIDGET_MINIMIZED_SIZE,
  type SnapEdge,
  type WidgetLayout
} from '../src/chat-shell/layout-geometry.js'

const viewport = { width: 1000, height: 800 }

describe('detectSnapEdge (#324 snap zones)', () => {
  it('returns null when the pointer is away from every edge', () => {
    expect(detectSnapEdge({ x: 500, y: 400 }, viewport)).toBeNull()
  })

  it('arms each edge when the pointer is within the threshold', () => {
    expect(detectSnapEdge({ x: 10, y: 400 }, viewport)).toBe('left')
    expect(detectSnapEdge({ x: 990, y: 400 }, viewport)).toBe('right')
    expect(detectSnapEdge({ x: 500, y: 10 }, viewport)).toBe('top')
    expect(detectSnapEdge({ x: 500, y: 790 }, viewport)).toBe('bottom')
  })

  it('does not arm exactly at the threshold distance (strictly inside)', () => {
    // Distance from the left edge equal to the threshold is not yet inside.
    expect(detectSnapEdge({ x: SNAP_THRESHOLD, y: 400 }, viewport)).toBeNull()
    expect(detectSnapEdge({ x: SNAP_THRESHOLD - 1, y: 400 }, viewport)).toBe('left')
  })

  it('resolves a corner to the nearest edge', () => {
    // Closer to the top (y=8) than the left (x=20) → top wins.
    expect(detectSnapEdge({ x: 20, y: 8 }, viewport)).toBe('top')
    // Closer to the left (x=6) than the top (y=30) → left wins.
    expect(detectSnapEdge({ x: 6, y: 30 }, viewport)).toBe('left')
  })

  it('honours a custom threshold', () => {
    expect(detectSnapEdge({ x: 100, y: 400 }, viewport, 40)).toBeNull()
    expect(detectSnapEdge({ x: 100, y: 400 }, viewport, 200)).toBe('left')
  })
})

describe('isDeliberateSnap (#336 intent gate)', () => {
  const start = { x: 500, y: 400 }

  it('accepts travel of at least SNAP_INTENT_TRAVEL toward each edge', () => {
    expect(SNAP_INTENT_TRAVEL).toBe(24)
    expect(isDeliberateSnap(start, { x: 500, y: 376 }, 'top')).toBe(true)
    expect(isDeliberateSnap(start, { x: 500, y: 424 }, 'bottom')).toBe(true)
    expect(isDeliberateSnap(start, { x: 476, y: 400 }, 'left')).toBe(true)
    expect(isDeliberateSnap(start, { x: 524, y: 400 }, 'right')).toBe(true)
  })

  it('rejects travel one pixel short of the threshold', () => {
    expect(isDeliberateSnap(start, { x: 500, y: 377 }, 'top')).toBe(false)
    expect(isDeliberateSnap(start, { x: 500, y: 423 }, 'bottom')).toBe(false)
    expect(isDeliberateSnap(start, { x: 477, y: 400 }, 'left')).toBe(false)
    expect(isDeliberateSnap(start, { x: 523, y: 400 }, 'right')).toBe(false)
  })

  it('rejects a jittery click (a couple of px of travel)', () => {
    expect(isDeliberateSnap(start, { x: 502, y: 398 }, 'top')).toBe(false)
  })

  it('rejects sliding along an edge without moving toward it', () => {
    // Large horizontal travel inside the top zone is not intent to dock top.
    expect(isDeliberateSnap({ x: 100, y: 30 }, { x: 400, y: 30 }, 'top')).toBe(false)
  })

  it('honours a custom travel argument', () => {
    expect(isDeliberateSnap(start, { x: 500, y: 390 }, 'top', 10)).toBe(true)
    expect(isDeliberateSnap(start, { x: 500, y: 390 }, 'top', 11)).toBe(false)
  })
})

describe('snapPreviewRect', () => {
  it('fills half the viewport against the docked edge by default', () => {
    expect(snapPreviewRect('left', viewport)).toEqual({ left: 0, top: 0, width: 500, height: 800 })
    expect(snapPreviewRect('right', viewport)).toEqual({
      left: 500,
      top: 0,
      width: 500,
      height: 800
    })
    expect(snapPreviewRect('top', viewport)).toEqual({ left: 0, top: 0, width: 1000, height: 400 })
    expect(snapPreviewRect('bottom', viewport)).toEqual({
      left: 0,
      top: 400,
      width: 1000,
      height: 400
    })
  })

  it('honours a custom split fraction', () => {
    expect(snapPreviewRect('right', viewport, 0.3)).toEqual({
      left: 700,
      top: 0,
      width: 300,
      height: 800
    })
  })
})

describe('isVerticalEdge', () => {
  it('classifies top/bottom as vertical and left/right as horizontal', () => {
    const cases: Array<[SnapEdge, boolean]> = [
      ['top', true],
      ['bottom', true],
      ['left', false],
      ['right', false]
    ]
    for (const [edge, expected] of cases) {
      expect(isVerticalEdge(edge)).toBe(expected)
    }
  })
})

describe('clampSize', () => {
  it('clamps below the minimum up to `min`', () => {
    expect(clampSize(100, 1000, { min: 320, maxFraction: 0.6 })).toBe(320)
  })

  it('clamps above the max fraction of the axis extent', () => {
    expect(clampSize(900, 1000, { min: 320, maxFraction: 0.6 })).toBe(600)
  })

  it('passes a value inside the range through (rounded)', () => {
    expect(clampSize(450.4, 1000, { min: 320, maxFraction: 0.6 })).toBe(450)
  })

  it('never lets the max fall below the min for a tiny extent', () => {
    expect(clampSize(50, 100, { min: 320, maxFraction: 0.6 })).toBe(320)
  })
})

describe('dockedResizeDelta (#356 splitter keys)', () => {
  it('moves the divider toward the viewport centre to grow the panel, per edge', () => {
    expect(dockedResizeDelta('ArrowLeft', 'right')).toBe(WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowRight', 'right')).toBe(-WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowRight', 'left')).toBe(WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowLeft', 'left')).toBe(-WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowDown', 'top')).toBe(WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowUp', 'top')).toBe(-WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowUp', 'bottom')).toBe(WIDGET_KEYBOARD_STEP)
    expect(dockedResizeDelta('ArrowDown', 'bottom')).toBe(-WIDGET_KEYBOARD_STEP)
  })

  it('returns null for arrows off the dock resize axis', () => {
    expect(dockedResizeDelta('ArrowUp', 'right')).toBeNull()
    expect(dockedResizeDelta('ArrowDown', 'left')).toBeNull()
    expect(dockedResizeDelta('ArrowLeft', 'top')).toBeNull()
    expect(dockedResizeDelta('ArrowRight', 'bottom')).toBeNull()
  })

  it('returns null for non-arrow keys', () => {
    expect(dockedResizeDelta('Enter', 'right')).toBeNull()
    expect(dockedResizeDelta('Home', 'top')).toBeNull()
  })

  it('honours a custom step', () => {
    expect(dockedResizeDelta('ArrowLeft', 'right', 4)).toBe(4)
    expect(dockedResizeDelta('ArrowRight', 'right', 4)).toBe(-4)
  })
})

describe('updatePersisted (#335)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('merges the patch into the stored object, keeping the other axis', () => {
    window.localStorage.setItem('test:persist', JSON.stringify({ width: 600 }))
    updatePersisted('test:persist', { height: 420 })
    expect(JSON.parse(window.localStorage.getItem('test:persist') ?? '{}')).toEqual({
      width: 600,
      height: 420
    })
  })

  it('stores just the patch when nothing is persisted yet', () => {
    updatePersisted('test:persist', { width: 500 })
    expect(JSON.parse(window.localStorage.getItem('test:persist') ?? '{}')).toEqual({ width: 500 })
  })

  it('replaces a stored non-object with the patch alone', () => {
    window.localStorage.setItem('test:persist', JSON.stringify('nope'))
    updatePersisted('test:persist', { width: 500 })
    expect(JSON.parse(window.localStorage.getItem('test:persist') ?? '{}')).toEqual({ width: 500 })

    window.localStorage.setItem('test:persist', JSON.stringify([1, 2]))
    updatePersisted('test:persist', { height: 300 })
    expect(JSON.parse(window.localStorage.getItem('test:persist') ?? '{}')).toEqual({ height: 300 })
  })
})

describe('clampLayout keeps the panel inside the viewport (issue #480 review)', () => {
  const dims = { defaultWidth: 400, defaultHeight: 680, minWidth: 320, minHeight: 420 }
  const setViewport = (width: number, height: number): void => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
  }
  const open = (over: Partial<WidgetLayout> = {}): WidgetLayout => ({
    x: 24,
    y: 24,
    width: 400,
    height: 680,
    minimized: false,
    ...over
  })

  it('keeps the safe margin when the viewport can afford it', () => {
    setViewport(1200, 900)
    const layout = clampLayout(open(), dims)

    expect(layout.x).toBeGreaterThanOrEqual(24)
    expect(layout.x + layout.width).toBeLessThanOrEqual(1200 - 24)
  })

  it('fits a 320px viewport rather than honouring an impossible minWidth', () => {
    // The reported case: minWidth 320 and a 24px margin on both sides cannot
    // both hold at 320 CSS pixels. Preferring the minimum pushed the right edge
    // — the resize handle and part of the shell bar — 24px off-screen, with no
    // way to scroll to it.
    setViewport(320, 568)
    const layout = clampLayout(open(), dims)

    expect(layout.x).toBeGreaterThanOrEqual(0)
    expect(layout.x + layout.width).toBeLessThanOrEqual(320)
  })

  it('fits a short viewport the same way', () => {
    setViewport(360, 420)
    const layout = clampLayout(open(), dims)

    expect(layout.y).toBeGreaterThanOrEqual(0)
    expect(layout.y + layout.height).toBeLessThanOrEqual(420)
  })

  it('fits a viewport smaller than the minimum on both axes', () => {
    setViewport(280, 380)
    const layout = clampLayout(open(), dims)

    expect(layout.x).toBeGreaterThanOrEqual(0)
    expect(layout.y).toBeGreaterThanOrEqual(0)
    expect(layout.x + layout.width).toBeLessThanOrEqual(280)
    expect(layout.y + layout.height).toBeLessThanOrEqual(380)
  })

  it('keeps a minimized launcher on screen too', () => {
    setViewport(320, 568)
    const layout = clampLayout(open({ minimized: true }), dims)

    expect(layout.x).toBeGreaterThanOrEqual(0)
    expect(layout.x + WIDGET_MINIMIZED_SIZE).toBeLessThanOrEqual(320)
  })
})
