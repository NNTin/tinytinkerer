import { describe, expect, it } from 'vitest'
import {
  clampSize,
  detectSnapEdge,
  isVerticalEdge,
  snapPreviewRect,
  SNAP_THRESHOLD,
  type SnapEdge
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
