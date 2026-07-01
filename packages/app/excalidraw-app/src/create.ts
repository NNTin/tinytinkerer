import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds
} from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DrawConnector, DrawElement, DrawInput } from '@tinytinkerer/excalidraw-protocol'
import { uniqueId } from './ids'
import { assertRequestBudget } from './query'

const skeleton = (element: DrawElement): Record<string, unknown> => {
  const base = {
    ...(element.id ? { id: element.id } : {}),
    x: element.x,
    y: element.y,
    ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
    ...(element.backgroundColor ? { backgroundColor: element.backgroundColor } : {})
  }
  if (element.type === 'text') return { ...base, type: 'text', text: element.text ?? '' }
  const linear = element.type === 'arrow' || element.type === 'line'
  const width = element.width ?? 120
  const height = element.height ?? (linear ? 0 : 80)
  return {
    ...base,
    type: element.type,
    width,
    height,
    // Emit explicit points for linear elements so the delta comes straight from our
    // width/height. convertToExcalidrawElements derives a linear element's points via
    // `element.width || DEFAULT` (=100), which mistakes a legitimate width:0 vertical
    // line for "missing" and produces points [0,0]→[100,h] — a spine that veers right
    // and detaches from everything anchored to its intended x. Passing points here (it
    // spreads last in the line/arrow cases) keeps the stored geometry self-consistent.
    ...(linear
      ? {
          points: [
            [0, 0],
            [width, height]
          ]
        }
      : {}),
    ...(element.text ? { label: { text: element.text } } : {})
  }
}

type Point = { x: number; y: number }
type Bounds = {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  left: number
  right: number
  top: number
  bottom: number
}
type ElementEndpoint = Extract<DrawConnector['from'], { elementId: string }>
type ResolvedEndpoint =
  | { kind: 'point'; point: Point }
  | { kind: 'element'; element: OrderedExcalidrawElement; bounds: Bounds; side: ElementEndpoint }
type ConnectorReceipt = {
  id: string
  type: 'arrow' | 'line'
  routing: 'horizontal' | 'vertical'
  start: [number, number]
  end: [number, number]
  anchorRule: 'horizontal-row' | 'vertical-trunk'
  horizontal: boolean
  vertical: boolean
}

const elementBounds = (element: OrderedExcalidrawElement): Bounds => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  const width = x2 - x1
  const height = y2 - y1
  return {
    x: x1,
    y: y1,
    width,
    height,
    centerX: x1 + width / 2,
    centerY: y1 + height / 2,
    left: x1,
    right: x2,
    top: y1,
    bottom: y2
  }
}

const endpointCenter = (endpoint: ResolvedEndpoint): Point =>
  endpoint.kind === 'point'
    ? endpoint.point
    : { x: endpoint.bounds.centerX, y: endpoint.bounds.centerY }

const resolveEndpoint = (
  endpoint: DrawConnector['from'],
  elements: ReadonlyMap<string, OrderedExcalidrawElement>
): ResolvedEndpoint => {
  if ('elementId' in endpoint) {
    const element = elements.get(endpoint.elementId)
    if (!element)
      throw new Error(`draw: connector references unknown element "${endpoint.elementId}"`)
    return { kind: 'element', element, bounds: elementBounds(element), side: endpoint }
  }
  return { kind: 'point', point: { x: endpoint.x, y: endpoint.y } }
}

const chooseRouting = (
  connector: DrawConnector,
  start: ResolvedEndpoint,
  end: ResolvedEndpoint
): 'horizontal' | 'vertical' => {
  if (connector.routing === 'horizontal' || connector.routing === 'vertical')
    return connector.routing
  const startCenter = endpointCenter(start)
  const endCenter = endpointCenter(end)
  return Math.abs(endCenter.x - startCenter.x) >= Math.abs(endCenter.y - startCenter.y)
    ? 'horizontal'
    : 'vertical'
}

const sharedRowY = (
  connector: DrawConnector,
  start: ResolvedEndpoint,
  end: ResolvedEndpoint
): number => {
  if (connector.rowY !== undefined) return connector.rowY
  if (start.kind === 'point') return start.point.y
  if (end.kind === 'point') return end.point.y
  return (start.bounds.centerY + end.bounds.centerY) / 2
}

const sharedTrunkX = (
  connector: DrawConnector,
  start: ResolvedEndpoint,
  end: ResolvedEndpoint
): number => {
  if (connector.trunkX !== undefined) return connector.trunkX
  if (start.kind === 'point') return start.point.x
  if (end.kind === 'point') return end.point.x
  return (start.bounds.centerX + end.bounds.centerX) / 2
}

const horizontalPoint = (endpoint: ResolvedEndpoint, other: Point, rowY: number): Point => {
  if (endpoint.kind === 'point') return { x: endpoint.point.x, y: rowY }
  const { bounds } = endpoint
  const side = endpoint.side.side
  if (side === 'center') return { x: bounds.centerX, y: rowY }
  if (side === 'left') return { x: bounds.left, y: rowY }
  if (side === 'right') return { x: bounds.right, y: rowY }
  if (side === 'top' || side === 'bottom') return { x: bounds.centerX, y: rowY }
  return { x: other.x >= bounds.centerX ? bounds.right : bounds.left, y: rowY }
}

const verticalPoint = (endpoint: ResolvedEndpoint, other: Point, trunkX: number): Point => {
  if (endpoint.kind === 'point') return { x: trunkX, y: endpoint.point.y }
  const { bounds } = endpoint
  const side = endpoint.side.side
  if (side === 'center') return { x: trunkX, y: bounds.centerY }
  if (side === 'top') return { x: trunkX, y: bounds.top }
  if (side === 'bottom') return { x: trunkX, y: bounds.bottom }
  if (side === 'left' || side === 'right') return { x: trunkX, y: bounds.centerY }
  return { x: trunkX, y: other.y >= bounds.centerY ? bounds.bottom : bounds.top }
}

const connectorSkeleton = (
  connector: DrawConnector,
  id: string,
  start: Point,
  end: Point
): Record<string, unknown> => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return {
    id,
    type: connector.type,
    x: start.x,
    y: start.y,
    width: dx,
    height: dy,
    points: [
      [0, 0],
      [dx, dy]
    ],
    ...(connector.strokeColor ? { strokeColor: connector.strokeColor } : {}),
    ...(connector.backgroundColor ? { backgroundColor: connector.backgroundColor } : {}),
    ...(connector.text ? { label: { text: connector.text } } : {})
  }
}

const buildConnector = (
  connector: DrawConnector,
  elements: ReadonlyMap<string, OrderedExcalidrawElement>,
  usedIds: Set<string>
): { skeleton: Record<string, unknown>; receipt: ConnectorReceipt } => {
  const resolvedStart = resolveEndpoint(connector.from, elements)
  const resolvedEnd = resolveEndpoint(connector.to, elements)
  const routing = chooseRouting(connector, resolvedStart, resolvedEnd)
  const startCenter = endpointCenter(resolvedStart)
  const endCenter = endpointCenter(resolvedEnd)
  const start =
    routing === 'horizontal'
      ? horizontalPoint(resolvedStart, endCenter, sharedRowY(connector, resolvedStart, resolvedEnd))
      : verticalPoint(resolvedStart, endCenter, sharedTrunkX(connector, resolvedStart, resolvedEnd))
  const end =
    routing === 'horizontal'
      ? horizontalPoint(resolvedEnd, startCenter, start.y)
      : verticalPoint(resolvedEnd, startCenter, start.x)
  if (connector.id && usedIds.has(connector.id))
    throw new Error(`draw: connector id "${connector.id}" already exists in the scene`)
  const id = connector.id ?? uniqueId('tt-connector', usedIds)
  if (connector.id) usedIds.add(connector.id)
  return {
    skeleton: connectorSkeleton(connector, id, start, end),
    receipt: {
      id,
      type: connector.type,
      routing,
      start: [start.x, start.y],
      end: [end.x, end.y],
      anchorRule: routing === 'horizontal' ? 'horizontal-row' : 'vertical-trunk',
      horizontal: start.y === end.y,
      vertical: start.x === end.x
    }
  }
}

export const executeDraw = (api: ExcalidrawImperativeAPI, input: DrawInput) => {
  assertRequestBudget('draw', input)
  const existing = input.replace ? [] : api.getSceneElements()
  const usedIds = new Set(existing.map(({ id }) => id))
  const preparedElements = input.elements.map((element) => {
    if (element.id && usedIds.has(element.id))
      throw new Error(`draw: element id "${element.id}" already exists in the scene`)
    const id = element.id ?? uniqueId('tt-element', usedIds)
    if (element.id) usedIds.add(element.id)
    return { ...element, id }
  })
  const convertedElements = convertToExcalidrawElements(
    preparedElements.map(skeleton) as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false }
  )
  const elementsById = new Map<string, OrderedExcalidrawElement>(
    [...existing, ...convertedElements].map((element) => [element.id, element])
  )
  const connectors = input.connectors.map((connector) =>
    buildConnector(connector, elementsById, usedIds)
  )
  const convertedConnectors = convertToExcalidrawElements(
    connectors.map(({ skeleton }) => skeleton) as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false }
  )
  const converted = [...convertedElements, ...convertedConnectors]
  api.updateScene({
    elements: [...existing, ...converted],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY
  })
  api.scrollToContent(converted, { fitToContent: true })
  return {
    ok: true as const,
    drawn: converted.length,
    replaced: input.replace === true,
    connectors: connectors.map(({ receipt }) => receipt)
  }
}

export const executeClear = (api: ExcalidrawImperativeAPI, input: Record<string, never>) => {
  assertRequestBudget('clear', input)
  api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  return { ok: true as const }
}
