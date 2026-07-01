import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type { AuditInput, BindInput, ConnectorAudit } from '@tinytinkerer/excalidraw-protocol'
import {
  anchorPointOnBounds,
  bindingOf,
  boxOf,
  centerOf,
  connectorEndpoints,
  connectorGeometry,
  distanceToBox,
  isDegenerate,
  isLinear,
  updateWith,
  type LinearBinding,
  type Point
} from './geometry'
import { changedByIdentity, commitWrite } from './mutation'
import { elementMap, sceneVersionOf } from './normalization'
import { settleSerializedBytes, trimToBudget } from './payload'
import { assertRequestBudget, makePage } from './query'

// Connector binding behavior: rebind/detach a connector endpoint (`bind`) and
// report binding health (`audit`). The endpoint geometry — the deterministic
// edge-anchor policy and the reflow used by `transform` — lives in `geometry.ts`.

// How far a bound endpoint may drift from its target (beyond `gap`) before `audit`
// flags it as stale.
const STALE_TOLERANCE = 16

// A connector may bind to any non-linear, non-freehand element (shapes, text,
// frames, images, embeds). Linear elements and freedraw are not bind targets.
const isBindable = (element: OrderedExcalidrawElement): boolean =>
  !isLinear(element) && element.type !== 'freedraw'

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
    if (spec?.action === 'attach' && attachTarget) return centerOf(boxOf(attachTarget))
    if (spec?.action === 'detach') return currentPoint
    if (prev) {
      const target = byId.get(prev.elementId)
      if (target) return centerOf(boxOf(target))
    }
    return currentPoint
  }
  const startRef = refFor(input.start, startTarget, prevStart, current.start)
  const endRef = refFor(input.end, endTarget, prevEnd, current.end)

  const nextStart: Point =
    input.start?.action === 'attach' && startTarget
      ? anchorPointOnBounds(
          boxOf(startTarget),
          endRef,
          input.start.anchor.focus,
          input.start.anchor.gap
        )
      : current.start
  const nextEnd: Point =
    input.end?.action === 'attach' && endTarget
      ? anchorPointOnBounds(
          boxOf(endTarget),
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
      ? { elementId: startTarget!.id, focus: input.start.anchor.focus, gap: input.start.anchor.gap }
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
  const changedIds = changedByIdentity(elements, nextElements)

  return commitWrite(api, nextElements, changedIds, EXCALIDRAW_PAYLOAD_BUDGETS.bind.result, {
    connectorId: connector.id,
    start: endpointStateOf(nextStartBinding),
    end: endpointStateOf(nextEndBinding)
  })
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
  if (distanceToBox(point, boxOf(target)) > binding.gap + STALE_TOLERANCE)
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
  return trimToBudget(
    (count) => {
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
    },
    sliceLength,
    budget
  )
}
