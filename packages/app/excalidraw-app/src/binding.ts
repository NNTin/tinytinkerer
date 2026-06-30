import { CaptureUpdateAction, getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type { AuditInput, BindInput, ConnectorAudit } from '@tinytinkerer/excalidraw-protocol'
import { attachBoundedRecords, versionReceipts } from './mutation'
import { elementMap, sceneVersionOf } from './normalization'
import { settleSerializedBytes } from './payload'
import { assertRequestBudget, makePage } from './query'

// Connector binding behavior: rebind/detach a connector endpoint to a target
// shape and anchor point (`bind`), re-anchor connectors whose bound shapes moved
// or resized (`reflowBoundConnectors`, used by `transform`), and report binding
// health (`audit`). All endpoint geometry uses one deterministic edge-anchor
// policy so connectors stay readable: the facing edge is chosen from the opposite
// endpoint, `focus` slides the anchor along that edge, and `gap` offsets it out.

type Point = { x: number; y: number }
type Bounds = {
  x1: number
  y1: number
  x2: number
  y2: number
  cx: number
  cy: number
  width: number
  height: number
}

// Endpoints closer than this would render as a zero-length, unreadable connector.
const MIN_CONNECTOR_LENGTH = 1
// How far a bound endpoint may drift from its target (beyond `gap`) before `audit`
// flags it as stale.
const STALE_TOLERANCE = 16

const updateWith = (
  element: OrderedExcalidrawElement,
  updates: Record<string, unknown>
): OrderedExcalidrawElement =>
  newElementWith(element, updates as Parameters<typeof newElementWith<OrderedExcalidrawElement>>[1])

const isLinear = (element: OrderedExcalidrawElement): boolean =>
  element.type === 'arrow' || element.type === 'line'

// A connector may bind to any non-linear, non-freehand element (shapes, text,
// frames, images, embeds). Linear elements and freedraw are not bind targets.
const isBindable = (element: OrderedExcalidrawElement): boolean =>
  !isLinear(element) && element.type !== 'freedraw'

const boundsOf = (element: OrderedExcalidrawElement): Bounds => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, width: x2 - x1, height: y2 - y1 }
}

const centerOf = (bounds: Bounds): Point => ({ x: bounds.cx, y: bounds.cy })

// The point on a target's facing edge for a bound endpoint. The edge is chosen by
// the dominant direction toward the opposite endpoint; `focus` slides along it and
// `gap` pushes it outward. Recomputing from the target's current bounds keeps the
// same focus valid after a move or resize.
const anchorPointOnBounds = (bounds: Bounds, toward: Point, focus: number, gap: number): Point => {
  const dx = toward.x - bounds.cx
  const dy = toward.y - bounds.cy
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x = dx >= 0 ? bounds.x2 + gap : bounds.x1 - gap
    return { x, y: bounds.cy + focus * (bounds.height / 2) }
  }
  const y = dy >= 0 ? bounds.y2 + gap : bounds.y1 - gap
  return { x: bounds.cx + focus * (bounds.width / 2), y }
}

const connectorEndpoints = (connector: OrderedExcalidrawElement): { start: Point; end: Point } => {
  const points = (connector as { points?: ReadonlyArray<readonly [number, number]> }).points ?? []
  const first = points[0] ?? [0, 0]
  const last = points[points.length - 1] ?? first
  return {
    start: { x: connector.x + first[0], y: connector.y + first[1] },
    end: { x: connector.x + last[0], y: connector.y + last[1] }
  }
}

const connectorGeometry = (start: Point, end: Point): Record<string, unknown> => {
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

const isDegenerate = (start: Point, end: Point): boolean =>
  Math.hypot(end.x - start.x, end.y - start.y) < MIN_CONNECTOR_LENGTH

type LinearBinding = { elementId: string; focus: number; gap: number } | null

const bindingOf = (element: OrderedExcalidrawElement, end: 'start' | 'end'): LinearBinding => {
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
// opposite endpoint keeps its current point. Used by `transform` under
// `reflowConnectors`. A recompute that would collapse the connector is skipped.
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
    const startRef = startTarget ? centerOf(boundsOf(startTarget)) : curStart
    const endRef = endTarget ? centerOf(boundsOf(endTarget)) : curEnd
    const nextStart =
      startChanged && startTarget
        ? anchorPointOnBounds(boundsOf(startTarget), endRef, startBinding!.focus, startBinding!.gap)
        : curStart
    const nextEnd =
      endChanged && endTarget
        ? anchorPointOnBounds(boundsOf(endTarget), startRef, endBinding!.focus, endBinding!.gap)
        : curEnd
    if (isDegenerate(nextStart, nextEnd)) return element
    return updateWith(element, connectorGeometry(nextStart, nextEnd))
  })
}

const endpointStateOf = (binding: LinearBinding) => ({
  bound: binding !== null,
  targetId: binding?.elementId ?? null,
  focus: binding?.focus ?? null,
  gap: binding?.gap ?? null
})

export const executeBind = (api: ExcalidrawImperativeAPI, input: BindInput) => {
  assertRequestBudget('bind', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  if (input.expectedSceneVersion !== sceneVersion)
    throw new Error(
      `bind: scene changed (expected scene version ${input.expectedSceneVersion}, current version ${sceneVersion}); read it again before retrying`
    )
  const byId = elementMap(elements)
  const connector = byId.get(input.connector.id)
  if (!connector) throw new Error(`bind: connector "${input.connector.id}" does not exist`)
  if (connector.version !== input.connector.expectedVersion)
    throw new Error(
      `bind: connector "${input.connector.id}" is stale (expected version ${input.connector.expectedVersion}, current version ${connector.version}); read it again before retrying`
    )
  if (!isLinear(connector))
    throw new Error(`bind: element "${input.connector.id}" is not an arrow or line connector`)
  if (connector.locked)
    throw new Error(`bind: connector "${input.connector.id}" is locked; unlock it before binding`)

  const resolveTarget = (
    end: 'start' | 'end',
    ref: { id: string; expectedVersion: number }
  ): OrderedExcalidrawElement => {
    const target = byId.get(ref.id)
    if (!target) throw new Error(`bind: ${end} target "${ref.id}" does not exist`)
    if (target.version !== ref.expectedVersion)
      throw new Error(
        `bind: ${end} target "${ref.id}" is stale (expected version ${ref.expectedVersion}, current version ${target.version}); read it again before retrying`
      )
    if (target.id === connector.id) throw new Error(`bind: a connector cannot bind to itself`)
    if (!isBindable(target))
      throw new Error(`bind: element "${ref.id}" of type "${target.type}" is not a bind target`)
    return target
  }

  const startTarget =
    input.start?.action === 'attach' ? resolveTarget('start', input.start.target) : null
  const endTarget = input.end?.action === 'attach' ? resolveTarget('end', input.end.target) : null

  const current = connectorEndpoints(connector)
  const prevStart = bindingOf(connector, 'start')
  const prevEnd = bindingOf(connector, 'end')

  // "Toward" reference for each endpoint: where the opposite endpoint will be
  // centered, so the chosen edge faces it.
  const refFor = (
    spec: BindInput['start'],
    attachTarget: OrderedExcalidrawElement | null,
    prev: LinearBinding,
    currentPoint: Point
  ): Point => {
    if (spec?.action === 'attach' && attachTarget) return centerOf(boundsOf(attachTarget))
    if (spec?.action === 'detach') return currentPoint
    if (prev) {
      const target = byId.get(prev.elementId)
      if (target) return centerOf(boundsOf(target))
    }
    return currentPoint
  }
  const startRef = refFor(input.start, startTarget, prevStart, current.start)
  const endRef = refFor(input.end, endTarget, prevEnd, current.end)

  const nextStart: Point =
    input.start?.action === 'attach' && startTarget
      ? anchorPointOnBounds(
          boundsOf(startTarget),
          endRef,
          input.start.anchor.focus,
          input.start.anchor.gap
        )
      : current.start
  const nextEnd: Point =
    input.end?.action === 'attach' && endTarget
      ? anchorPointOnBounds(
          boundsOf(endTarget),
          startRef,
          input.end.anchor.focus,
          input.end.anchor.gap
        )
      : current.end
  if (isDegenerate(nextStart, nextEnd))
    throw new Error(
      `bind: the requested binding would collapse the connector to zero length; choose a different anchor`
    )

  const nextStartBinding: LinearBinding =
    input.start?.action === 'attach'
      ? {
          elementId: startTarget!.id,
          focus: input.start.anchor.focus,
          gap: input.start.anchor.gap
        }
      : input.start?.action === 'detach'
        ? null
        : prevStart
  const nextEndBinding: LinearBinding =
    input.end?.action === 'attach'
      ? { elementId: endTarget!.id, focus: input.end.anchor.focus, gap: input.end.anchor.gap }
      : input.end?.action === 'detach'
        ? null
        : prevEnd

  const prevTargets = new Set(
    [prevStart?.elementId, prevEnd?.elementId].filter((id): id is string => Boolean(id))
  )
  const nextTargets = new Set(
    [nextStartBinding?.elementId, nextEndBinding?.elementId].filter((id): id is string =>
      Boolean(id)
    )
  )
  const addRef = new Set([...nextTargets].filter((id) => !prevTargets.has(id)))
  const removeRef = new Set([...prevTargets].filter((id) => !nextTargets.has(id)))

  const nextElements = elements.map((element) => {
    if (element.id === connector.id)
      return updateWith(element, {
        ...connectorGeometry(nextStart, nextEnd),
        startBinding: nextStartBinding,
        endBinding: nextEndBinding
      })
    if (addRef.has(element.id)) {
      const existing = element.boundElements ?? []
      if (existing.some((bound) => bound.id === connector.id)) return element
      return updateWith(element, {
        boundElements: [...existing, { id: connector.id, type: connector.type }]
      })
    }
    if (removeRef.has(element.id)) {
      const existing = element.boundElements ?? []
      if (!existing.some((bound) => bound.id === connector.id)) return element
      return updateWith(element, {
        boundElements: existing.filter((bound) => bound.id !== connector.id)
      })
    }
    return element
  })
  const changedIds = nextElements
    .filter((element, index) => element !== elements[index])
    .map((element) => element.id)
  if (changedIds.length > 0)
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })

  return attachBoundedRecords(
    {
      ok: true as const,
      updated: changedIds.length,
      sceneVersion: sceneVersionOf(nextElements),
      receipts: versionReceipts(nextElements, changedIds),
      connectorId: connector.id,
      start: endpointStateOf(nextStartBinding),
      end: endpointStateOf(nextEndBinding)
    },
    nextElements,
    changedIds,
    EXCALIDRAW_PAYLOAD_BUDGETS.bind.result
  )
}

// Squared/clamped distance from a point to a box (0 inside). Used to detect a
// bound endpoint that has drifted off its target.
const distanceToBox = (point: Point, bounds: Bounds): number => {
  const dx = Math.max(bounds.x1 - point.x, 0, point.x - bounds.x2)
  const dy = Math.max(bounds.y1 - point.y, 0, point.y - bounds.y2)
  return Math.hypot(dx, dy)
}

type EndpointAudit = ConnectorAudit['start']
type Repair = ConnectorAudit['repairs'][number]

const auditEndpoint = (
  end: 'start' | 'end',
  binding: LinearBinding,
  point: Point,
  connectorId: string,
  byId: ReadonlyMap<string, OrderedExcalidrawElement>
): { endpoint: EndpointAudit; repair: Repair | null } => {
  if (!binding)
    return {
      endpoint: { bound: false, targetId: null, status: 'unbound', focus: null, gap: null },
      repair: null
    }
  const base = {
    bound: true as const,
    targetId: binding.elementId,
    focus: binding.focus,
    gap: binding.gap
  }
  const target = byId.get(binding.elementId)
  if (!target)
    return {
      endpoint: { ...base, status: 'ambiguous' },
      repair: {
        endpoint: end,
        action: 'detach',
        targetId: binding.elementId,
        reason: 'binding references an element that is not in the scene'
      }
    }
  if (!isBindable(target))
    return {
      endpoint: { ...base, status: 'ambiguous' },
      repair: {
        endpoint: end,
        action: 'detach',
        targetId: target.id,
        reason: `binding points at a non-bindable ${target.type}`
      }
    }
  const reciprocated = (target.boundElements ?? []).some((bound) => bound.id === connectorId)
  if (!reciprocated)
    return {
      endpoint: { ...base, status: 'detached' },
      repair: {
        endpoint: end,
        action: 'rebind',
        targetId: target.id,
        reason: 'target does not list this connector; rebind to restore the link or detach'
      }
    }
  if (distanceToBox(point, boundsOf(target)) > binding.gap + STALE_TOLERANCE)
    return {
      endpoint: { ...base, status: 'stale' },
      repair: {
        endpoint: end,
        action: 'rebind',
        targetId: target.id,
        reason: 'endpoint has drifted away from its target; rebind to re-anchor it'
      }
    }
  return { endpoint: { ...base, status: 'ok' }, repair: null }
}

const auditConnector = (
  connector: OrderedExcalidrawElement,
  byId: ReadonlyMap<string, OrderedExcalidrawElement>,
  includeRepairs: boolean
): ConnectorAudit => {
  const points = connectorEndpoints(connector)
  const start = auditEndpoint(
    'start',
    bindingOf(connector, 'start'),
    points.start,
    connector.id,
    byId
  )
  const end = auditEndpoint('end', bindingOf(connector, 'end'), points.end, connector.id, byId)
  const issues = [start.endpoint.status, end.endpoint.status].filter(
    (status): status is 'stale' | 'detached' | 'ambiguous' =>
      status === 'stale' || status === 'detached' || status === 'ambiguous'
  )
  const repairs = includeRepairs
    ? [start.repair, end.repair].filter((repair): repair is Repair => repair !== null)
    : []
  return {
    id: connector.id,
    type: connector.type === 'line' ? 'line' : 'arrow',
    version: connector.version,
    start: start.endpoint,
    end: end.endpoint,
    issues,
    repairs
  }
}

export const executeAudit = (api: ExcalidrawImperativeAPI, input: AuditInput) => {
  assertRequestBudget('audit', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  if (input.expectedSceneVersion !== undefined && input.expectedSceneVersion !== sceneVersion)
    throw new Error(
      `audit: scene changed (expected scene version ${input.expectedSceneVersion}, current version ${sceneVersion}); restart pagination from offset 0`
    )
  const byId = elementMap(elements)
  const connectors = elements.filter(isLinear)
  const requested = input.connectorIds
  const pool = requested
    ? connectors.filter((connector) => requested.includes(connector.id))
    : connectors
  const missingIds = requested ? requested.filter((id) => !byId.has(id)) : []
  const includeRepairs = input.detail !== 'summary'
  const audits = pool.map((connector) => auditConnector(connector, byId, includeRepairs))
  const flagged = audits.filter((audit) => audit.issues.length > 0).length
  const healthy = audits.length - flagged

  const budget = EXCALIDRAW_PAYLOAD_BUDGETS.audit.result
  const sliceLength = audits.slice(input.offset, input.offset + input.limit).length
  let returned = sliceLength
  const build = (count: number) => {
    const pageItems = audits.slice(input.offset, input.offset + count)
    const page = makePage(input.offset, input.limit, pageItems.length, audits.length)
    const omittedElements = sliceLength - pageItems.length
    const result = {
      ok: true as const,
      detail: input.detail,
      sceneVersion,
      connectors: pageItems,
      healthy,
      flagged,
      missingIds,
      page,
      truncation: {
        truncated: omittedElements > 0 || page.nextOffset !== null,
        fields: [] as string[],
        omittedElements,
        serializedBytes: 0,
        budgetBytes: budget
      }
    }
    settleSerializedBytes(result)
    return result
  }
  let result = build(returned)
  while (result.truncation.serializedBytes > budget && returned > 0) {
    returned -= 1
    result = build(returned)
  }
  if (result.truncation.serializedBytes > budget)
    throw new Error(`result metadata exceeds the ${budget} byte payload budget`)
  return result
}
