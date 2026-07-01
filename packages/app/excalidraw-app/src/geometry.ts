import { getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { elementMap } from './normalization'

// Shared element geometry for the write/read verbs. This is the one home for the
// axis-aligned box math, the deterministic connector edge-anchor policy, and the
// bound-connector reflow — so `structure.ts` (align/transform), `binding.ts`
// (bind/audit), and `layout.ts` (snap/place/arrange/survey) consume one set of
// primitives instead of re-deriving them. It depends only on `@excalidraw` and
// `normalization`, so it never forms an import cycle with the verb modules.

export type Point = { x: number; y: number }
export type Box = {
  x1: number
  y1: number
  x2: number
  y2: number
  cx: number
  cy: number
  width: number
  height: number
}

// Endpoints closer than this render as a zero-length, unreadable connector.
const MIN_CONNECTOR_LENGTH = 1

// The single spot that launders an untyped patch through `newElementWith`'s cast.
export const updateWith = (
  element: OrderedExcalidrawElement,
  updates: Record<string, unknown>
): OrderedExcalidrawElement =>
  newElementWith(element, updates as Parameters<typeof newElementWith<OrderedExcalidrawElement>>[1])

export const isLinear = (element: OrderedExcalidrawElement): boolean =>
  element.type === 'arrow' || element.type === 'line'

export const boxOf = (element: OrderedExcalidrawElement): Box => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, width: x2 - x1, height: y2 - y1 }
}

export const combinedBox = (elements: readonly OrderedExcalidrawElement[]): Box => {
  const [x1, y1, x2, y2] = getCommonBounds(elements)
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, width: x2 - x1, height: y2 - y1 }
}

// Two boxes overlap when they share positive area (touching edges do not count).
export const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

export const centerOf = (box: Box): Point => ({ x: box.cx, y: box.cy })

// Clamped Euclidean distance from a point to a box (0 inside). Used to detect a
// bound connector endpoint that has drifted off its target.
export const distanceToBox = (point: Point, box: Box): number => {
  const dx = Math.max(box.x1 - point.x, 0, point.x - box.x2)
  const dy = Math.max(box.y1 - point.y, 0, point.y - box.y2)
  return Math.hypot(dx, dy)
}

// The point on a target's facing edge for a bound endpoint. The edge is chosen by
// the dominant direction toward the opposite endpoint; `focus` slides along it and
// `gap` pushes it outward. Recomputing from the target's current box keeps the
// same focus valid after a move or resize.
export const anchorPointOnBounds = (box: Box, toward: Point, focus: number, gap: number): Point => {
  const dx = toward.x - box.cx
  const dy = toward.y - box.cy
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x = dx >= 0 ? box.x2 + gap : box.x1 - gap
    return { x, y: box.cy + focus * (box.height / 2) }
  }
  const y = dy >= 0 ? box.y2 + gap : box.y1 - gap
  return { x: box.cx + focus * (box.width / 2), y }
}

export const connectorEndpoints = (
  connector: OrderedExcalidrawElement
): { start: Point; end: Point } => {
  const points = (connector as { points?: ReadonlyArray<readonly [number, number]> }).points ?? []
  const first = points[0] ?? [0, 0]
  const last = points[points.length - 1] ?? first
  return {
    start: { x: connector.x + first[0], y: connector.y + first[1] },
    end: { x: connector.x + last[0], y: connector.y + last[1] }
  }
}

export const connectorGeometry = (start: Point, end: Point): Record<string, unknown> => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return {
    x: start.x,
    y: start.y,
    width: dx,
    height: dy,
    points: [
      [0, 0],
      [dx, dy]
    ]
  }
}

export const isDegenerate = (start: Point, end: Point): boolean =>
  Math.hypot(end.x - start.x, end.y - start.y) < MIN_CONNECTOR_LENGTH

export type LinearBinding = { elementId: string; focus: number; gap: number } | null

export const bindingOf = (
  element: OrderedExcalidrawElement,
  end: 'start' | 'end'
): LinearBinding => {
  const value = (element as Record<string, unknown>)[`${end}Binding`]
  if (!value || typeof value !== 'object') return null
  const binding = value as { elementId?: unknown; focus?: unknown; gap?: unknown }
  if (typeof binding.elementId !== 'string') return null
  return {
    elementId: binding.elementId,
    focus: typeof binding.focus === 'number' ? binding.focus : 0,
    gap: typeof binding.gap === 'number' ? binding.gap : 0
  }
}

// Re-anchor every connector bound to a moved or resized shape so its endpoints
// follow. Only endpoints whose target is in `changedTargetIds` are recomputed; the
// opposite endpoint keeps its current point. A recompute that would collapse the
// connector is skipped. Used by `transform`'s reflow and the layout writes.
export const reflowBoundConnectors = (
  elements: readonly OrderedExcalidrawElement[],
  changedTargetIds: ReadonlySet<string>
): OrderedExcalidrawElement[] => {
  if (changedTargetIds.size === 0) return elements.map((element) => element)
  const byId = elementMap(elements)
  return elements.map((element) => {
    if (!isLinear(element)) return element
    const startBinding = bindingOf(element, 'start')
    const endBinding = bindingOf(element, 'end')
    const startChanged = Boolean(startBinding && changedTargetIds.has(startBinding.elementId))
    const endChanged = Boolean(endBinding && changedTargetIds.has(endBinding.elementId))
    if (!startChanged && !endChanged) return element
    const { start: curStart, end: curEnd } = connectorEndpoints(element)
    const startTarget = startBinding ? byId.get(startBinding.elementId) : undefined
    const endTarget = endBinding ? byId.get(endBinding.elementId) : undefined
    const startRef = startTarget ? centerOf(boxOf(startTarget)) : curStart
    const endRef = endTarget ? centerOf(boxOf(endTarget)) : curEnd
    const nextStart =
      startChanged && startTarget
        ? anchorPointOnBounds(boxOf(startTarget), endRef, startBinding!.focus, startBinding!.gap)
        : curStart
    const nextEnd =
      endChanged && endTarget
        ? anchorPointOnBounds(boxOf(endTarget), startRef, endBinding!.focus, endBinding!.gap)
        : curEnd
    if (isDegenerate(nextStart, nextEnd)) return element
    return updateWith(element, connectorGeometry(nextStart, nextEnd))
  })
}
