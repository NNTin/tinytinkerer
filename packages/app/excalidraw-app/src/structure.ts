import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type {
  AlignInput,
  DeleteInput,
  DistributeInput,
  DuplicateInput,
  GroupInput,
  OrderInput,
  StackInput,
  TransformInput
} from '@tinytinkerer/excalidraw-protocol'
import { boxOf, isLinear, reflowBoundConnectors, updateWith } from './geometry'
import { uniqueId } from './ids'
import { attachBoundedRecords, changedByIdentity, commitWrite } from './mutation'
import { elementMap, sceneVersionOf } from './normalization'
import { assertRequestBudget } from './query'

// Structural editing verbs. They reorder, group, duplicate, delete, align, and
// translate existing elements. Every mutation is preflighted (version + relation
// safety) before a single atomic, undoable `updateScene` (via `commitWrite`);
// nothing partial is committed. Geometry helpers (in `geometry.ts`) carry rigid
// relationships (labels follow their container, frame children follow their frame,
// connectors follow consistently moved endpoints) so the scene never desyncs.

export type Delta = { dx: number; dy: number }

const resolveScene = (
  api: ExcalidrawImperativeAPI,
  verb: string,
  expectedSceneVersion: number | undefined
): { elements: readonly OrderedExcalidrawElement[]; sceneVersion: number } => {
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  if (expectedSceneVersion !== undefined && expectedSceneVersion !== sceneVersion)
    throw new Error(
      `${verb}: scene changed (expected scene version ${expectedSceneVersion}, current version ${sceneVersion}); read it again before retrying`
    )
  return { elements, sceneVersion }
}

type VersionedRef = { id: string; expectedVersion: number }

// Resolve operands with versioning-by-default. Explicit `refs` are validated to
// exist and to match their `expectedVersion` (order preserved); the scene
// version is checked in `resolveScene`. When `refs` is omitted we fall back to
// the live canvas selection — the only un-versioned convenience path.
export const resolveOperands = (
  api: ExcalidrawImperativeAPI,
  verb: string,
  refs: readonly VersionedRef[] | undefined,
  expectedSceneVersion: number | undefined
): {
  elements: readonly OrderedExcalidrawElement[]
  sceneVersion: number
  targets: OrderedExcalidrawElement[]
} => {
  const { elements, sceneVersion } = resolveScene(api, verb, expectedSceneVersion)
  if (refs === undefined) {
    const selected = new Set(Object.keys(api.getAppState().selectedElementIds))
    return {
      elements,
      sceneVersion,
      targets: elements.filter((element) => selected.has(element.id))
    }
  }
  const byId = elementMap(elements)
  const targets = refs.map((ref) => {
    const element = byId.get(ref.id)
    if (!element) throw new Error(`${verb}: element "${ref.id}" does not exist`)
    if (element.version !== ref.expectedVersion)
      throw new Error(
        `${verb}: element "${ref.id}" is stale (expected version ${ref.expectedVersion}, current version ${element.version}); read it again before retrying`
      )
    return element
  })
  return { elements, sceneVersion, targets }
}

// Translate elements by a per-element delta, expanding rigid dependents so the
// related geometry stays consistent. Returns the new element array (unchanged
// elements keep their identity) plus the ids that actually moved.
export const applyDeltas = (
  elements: readonly OrderedExcalidrawElement[],
  baseDeltas: ReadonlyMap<string, Delta>
): { nextElements: OrderedExcalidrawElement[]; movedIds: string[] } => {
  const deltas = new Map(baseDeltas)
  for (const element of elements) {
    if (deltas.has(element.id)) continue
    if (element.type === 'text' && element.containerId && deltas.has(element.containerId))
      deltas.set(element.id, deltas.get(element.containerId)!)
    else if (element.frameId && deltas.has(element.frameId))
      deltas.set(element.id, deltas.get(element.frameId)!)
  }
  for (const element of elements) {
    if (!isLinear(element) || deltas.has(element.id)) continue
    const start = element.type === 'arrow' || element.type === 'line' ? element.startBinding : null
    const end = element.type === 'arrow' || element.type === 'line' ? element.endBinding : null
    const startDelta = start ? deltas.get(start.elementId) : undefined
    const endDelta = end ? deltas.get(end.elementId) : undefined
    if (startDelta && endDelta && startDelta.dx === endDelta.dx && startDelta.dy === endDelta.dy)
      deltas.set(element.id, startDelta)
  }
  const movedIds: string[] = []
  const nextElements = elements.map((element) => {
    const delta = deltas.get(element.id)
    if (!delta || (delta.dx === 0 && delta.dy === 0)) return element
    movedIds.push(element.id)
    return updateWith(element, { x: element.x + delta.dx, y: element.y + delta.dy })
  })
  return { nextElements, movedIds }
}

export const executeAlign = (api: ExcalidrawImperativeAPI, input: AlignInput) => {
  assertRequestBudget('align', input)
  const { elements, targets } = resolveOperands(
    api,
    'align',
    input.elements,
    input.expectedSceneVersion
  )
  const baseDeltas = new Map<string, Delta>()
  if (targets.length >= 2) {
    const boxes = targets.map(boxOf)
    const minX = Math.min(...boxes.map((box) => box.x1))
    const maxX = Math.max(...boxes.map((box) => box.x2))
    const minY = Math.min(...boxes.map((box) => box.y1))
    const maxY = Math.max(...boxes.map((box) => box.y2))
    targets.forEach((element, index) => {
      const box = boxes[index]!
      let dx = 0
      let dy = 0
      if (input.axis === 'x') {
        const left =
          input.position === 'start'
            ? minX
            : input.position === 'end'
              ? maxX - box.width
              : (minX + maxX) / 2 - box.width / 2
        dx = left - box.x1
      } else {
        const top =
          input.position === 'start'
            ? minY
            : input.position === 'end'
              ? maxY - box.height
              : (minY + maxY) / 2 - box.height / 2
        dy = top - box.y1
      }
      if (dx !== 0 || dy !== 0) baseDeltas.set(element.id, { dx, dy })
    })
  }
  const { nextElements, movedIds } = applyDeltas(elements, baseDeltas)
  return commitWrite(api, nextElements, movedIds, EXCALIDRAW_PAYLOAD_BUDGETS.align.result)
}

export const executeDistribute = (api: ExcalidrawImperativeAPI, input: DistributeInput) => {
  assertRequestBudget('distribute', input)
  const { elements, targets } = resolveOperands(
    api,
    'distribute',
    input.elements,
    input.expectedSceneVersion
  )
  const baseDeltas = new Map<string, Delta>()
  if (targets.length >= 3) {
    const items = targets
      .map((element) => ({ element, box: boxOf(element) }))
      .sort((a, b) => (input.axis === 'x' ? a.box.x1 - b.box.x1 : a.box.y1 - b.box.y1))
    const start = input.axis === 'x' ? items[0]!.box.x1 : items[0]!.box.y1
    const last = items[items.length - 1]!.box
    const end = input.axis === 'x' ? last.x2 : last.y2
    const sizes = items.map((item) => (input.axis === 'x' ? item.box.width : item.box.height))
    const totalSize = sizes.reduce((sum, size) => sum + size, 0)
    const gap = (end - start - totalSize) / (items.length - 1)
    let cursor = start
    items.forEach((item, index) => {
      const target = cursor
      cursor += sizes[index]! + gap
      const current = input.axis === 'x' ? item.box.x1 : item.box.y1
      const delta = target - current
      if (delta !== 0)
        baseDeltas.set(
          item.element.id,
          input.axis === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta }
        )
    })
  }
  const { nextElements, movedIds } = applyDeltas(elements, baseDeltas)
  return commitWrite(api, nextElements, movedIds, EXCALIDRAW_PAYLOAD_BUDGETS.distribute.result)
}

export const executeStack = (api: ExcalidrawImperativeAPI, input: StackInput) => {
  assertRequestBudget('stack', input)
  const { elements, targets } = resolveOperands(
    api,
    'stack',
    input.elements,
    input.expectedSceneVersion
  )
  const baseDeltas = new Map<string, Delta>()
  if (targets.length >= 1) {
    const boxes = targets.map(boxOf)
    const first = boxes[0]!
    let cursor = input.direction === 'horizontal' ? first.x1 : first.y1
    targets.forEach((element, index) => {
      const box = boxes[index]!
      let dx: number
      let dy: number
      if (input.direction === 'horizontal') {
        dx = cursor - box.x1
        cursor += box.width + input.spacing
        const top =
          input.align === 'start'
            ? first.y1
            : input.align === 'end'
              ? first.y2 - box.height
              : first.cy - box.height / 2
        dy = top - box.y1
      } else {
        dy = cursor - box.y1
        cursor += box.height + input.spacing
        const left =
          input.align === 'start'
            ? first.x1
            : input.align === 'end'
              ? first.x2 - box.width
              : first.cx - box.width / 2
        dx = left - box.x1
      }
      if (dx !== 0 || dy !== 0) baseDeltas.set(element.id, { dx, dy })
    })
  }
  const { nextElements, movedIds } = applyDeltas(elements, baseDeltas)
  return commitWrite(api, nextElements, movedIds, EXCALIDRAW_PAYLOAD_BUDGETS.stack.result)
}

// Expand a target set with bound text labels so a container and its label keep
// their relative z-order when restacked.
const withBoundLabels = (
  elements: readonly OrderedExcalidrawElement[],
  ids: ReadonlySet<string>
): Set<string> => {
  const expanded = new Set(ids)
  for (const element of elements)
    if (element.type === 'text' && element.containerId && expanded.has(element.containerId))
      expanded.add(element.id)
  return expanded
}

export const executeOrder = (api: ExcalidrawImperativeAPI, input: OrderInput) => {
  assertRequestBudget('order', input)
  const { elements, targets } = resolveOperands(
    api,
    'order',
    input.elements,
    input.expectedSceneVersion
  )
  const targetSet = withBoundLabels(elements, new Set(targets.map((element) => element.id)))
  const members = elements.filter((element) => targetSet.has(element.id))
  const others = elements.filter((element) => !targetSet.has(element.id))
  let nextOrder: readonly OrderedExcalidrawElement[] = elements
  if (members.length > 0) {
    if (input.operation === 'front') nextOrder = [...others, ...members]
    else if (input.operation === 'back') nextOrder = [...members, ...others]
    else if (input.operation === 'forward') {
      const lastIndex = Math.max(...members.map((element) => elements.indexOf(element)))
      if (lastIndex < elements.length - 1) {
        const after = others.indexOf(elements[lastIndex + 1]!)
        nextOrder = [...others.slice(0, after + 1), ...members, ...others.slice(after + 1)]
      }
    } else {
      const firstIndex = Math.min(...members.map((element) => elements.indexOf(element)))
      if (firstIndex > 0) {
        const before = others.indexOf(elements[firstIndex - 1]!)
        nextOrder = [...others.slice(0, before), ...members, ...others.slice(before)]
      }
    }
  }
  const changedIds = members
    .map((element) => element.id)
    .filter(
      (id) =>
        nextOrder.findIndex((element) => element.id === id) !==
        elements.findIndex((element) => element.id === id)
    )
  return commitWrite(api, nextOrder, changedIds, EXCALIDRAW_PAYLOAD_BUDGETS.order.result)
}

export const executeGroup = (api: ExcalidrawImperativeAPI, input: GroupInput) => {
  assertRequestBudget('group', input)
  const { elements, targets } = resolveOperands(
    api,
    'group',
    input.elements,
    input.expectedSceneVersion
  )
  const groupResult = (
    operation: 'group' | 'ungroup',
    groupId: string | null,
    nextElements: readonly OrderedExcalidrawElement[],
    changedIds: readonly string[]
  ) =>
    commitWrite(api, nextElements, changedIds, EXCALIDRAW_PAYLOAD_BUDGETS.group.result, {
      operation,
      groupId
    })

  if (input.operation === 'group') {
    if (targets.length < 2) return groupResult('group', null, elements, [])
    const memberSet = withBoundLabels(elements, new Set(targets.map((element) => element.id)))
    const groupId = uniqueId('tt-group', new Set(elements.flatMap((element) => element.groupIds)))
    const changedIds: string[] = []
    const tagged = elements.map((element) => {
      if (!memberSet.has(element.id)) return element
      changedIds.push(element.id)
      return updateWith(element, { groupIds: [...element.groupIds, groupId] })
    })
    const lastIndex = Math.max(
      ...tagged.map((element, index) => (memberSet.has(element.id) ? index : -1))
    )
    const membersOrdered = tagged.filter((element) => memberSet.has(element.id))
    const before = tagged.slice(0, lastIndex + 1).filter((element) => !memberSet.has(element.id))
    const after = tagged.slice(lastIndex + 1)
    const nextElements = [...before, ...membersOrdered, ...after]
    return groupResult('group', groupId, nextElements, changedIds)
  }

  const removeIds = new Set(
    targets
      .map((element) => element.groupIds[element.groupIds.length - 1])
      .filter((id): id is string => Boolean(id))
  )
  if (removeIds.size === 0) return groupResult('ungroup', null, elements, [])
  const changedIds: string[] = []
  const nextElements = elements.map((element) => {
    const filtered = element.groupIds.filter((id) => !removeIds.has(id))
    if (filtered.length === element.groupIds.length) return element
    changedIds.push(element.id)
    return updateWith(element, { groupIds: filtered })
  })
  return groupResult('ungroup', null, nextElements, changedIds)
}

export const executeDuplicate = (api: ExcalidrawImperativeAPI, input: DuplicateInput) => {
  assertRequestBudget('duplicate', input)
  const { elements, targets: sources } = resolveOperands(
    api,
    'duplicate',
    input.elements,
    input.expectedSceneVersion
  )
  const sourceSet = withBoundLabels(elements, new Set(sources.map((element) => element.id)))
  const cluster = elements.filter((element) => sourceSet.has(element.id))
  const usedIds = new Set(elements.map((element) => element.id))
  const idMap = new Map<string, string>()
  for (const element of cluster) idMap.set(element.id, uniqueId('tt-element', usedIds))
  const usedGroups = new Set(elements.flatMap((element) => element.groupIds))
  const groupIdMap = new Map<string, string>()
  for (const element of cluster)
    for (const groupId of element.groupIds)
      if (!groupIdMap.has(groupId)) groupIdMap.set(groupId, uniqueId('tt-group', usedGroups))
  const remapBinding = (
    binding: { elementId: string } | null | undefined
  ): Record<string, unknown> | null =>
    binding && idMap.has(binding.elementId)
      ? { ...binding, elementId: idMap.get(binding.elementId)! }
      : null
  const copies = cluster.map((element) => {
    const updates: Record<string, unknown> = {
      id: idMap.get(element.id)!,
      x: element.x + input.offset.x,
      y: element.y + input.offset.y,
      groupIds: element.groupIds.map((groupId) => groupIdMap.get(groupId) ?? groupId),
      boundElements: (element.boundElements ?? [])
        .filter((bound) => idMap.has(bound.id))
        .map((bound) => ({ ...bound, id: idMap.get(bound.id)! })),
      frameId: element.frameId && idMap.has(element.frameId) ? idMap.get(element.frameId)! : null
    }
    if (element.type === 'text')
      updates.containerId =
        element.containerId && idMap.has(element.containerId)
          ? idMap.get(element.containerId)!
          : null
    if (element.type === 'arrow' || element.type === 'line') {
      updates.startBinding = remapBinding(element.startBinding)
      updates.endBinding = remapBinding(element.endBinding)
    }
    return updateWith(element, updates)
  })
  const nextElements = [...elements, ...copies]
  // duplicate has a bespoke result shape (idMap, no receipts), so it commits
  // directly rather than through `commitWrite`.
  if (copies.length > 0)
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  const newIds = copies.map((element) => element.id)
  return attachBoundedRecords(
    {
      ok: true as const,
      created: copies.length,
      sceneVersion: sceneVersionOf(nextElements),
      idMap: [...idMap].map(([sourceId, newId]) => ({ sourceId, newId }))
    },
    nextElements,
    newIds,
    EXCALIDRAW_PAYLOAD_BUDGETS.duplicate.result
  )
}

export const executeDelete = (api: ExcalidrawImperativeAPI, input: DeleteInput) => {
  assertRequestBudget('delete', input)
  const { elements, targets } = resolveOperands(
    api,
    'delete',
    input.elements,
    input.expectedSceneVersion
  )
  const explicit = new Set(targets.map((element) => element.id))
  const deletedIds = targets.map((element) => element.id)
  // Bound text labels are force-deleted with their container; that crosses a
  // relationship the caller did not list explicitly.
  const cascadeLabelIds = elements
    .filter(
      (element) =>
        element.type === 'text' &&
        element.containerId &&
        explicit.has(element.containerId) &&
        !explicit.has(element.id)
    )
    .map((element) => element.id)
  const removalSet = new Set([...explicit, ...cascadeLabelIds])
  // Surviving elements whose boundElements/connector bindings would be rewritten.
  const detachedSurvivorIds = elements
    .filter((element) => !removalSet.has(element.id))
    .filter(
      (element) =>
        element.boundElements?.some((bound) => removalSet.has(bound.id)) ||
        ((element.type === 'arrow' || element.type === 'line') &&
          ((element.startBinding && removalSet.has(element.startBinding.elementId)) ||
            (element.endBinding && removalSet.has(element.endBinding.elementId))))
    )
    .map((element) => element.id)
  // Predictable blast radius: refuse to cross relationships unless asked to.
  if (!input.includeRelated && (cascadeLabelIds.length > 0 || detachedSurvivorIds.length > 0)) {
    const crossings = [...new Set([...cascadeLabelIds, ...detachedSurvivorIds])]
    throw new Error(
      `delete: removing ${deletedIds.join(', ')} would affect related elements (${crossings.join(', ')}); pass includeRelated:true to cascade bound labels and detach connectors`
    )
  }
  const remaining = elements
    .filter((element) => !removalSet.has(element.id))
    .map((element) => {
      const updates: Record<string, unknown> = {}
      if (element.boundElements?.some((bound) => removalSet.has(bound.id)))
        updates.boundElements = element.boundElements.filter((bound) => !removalSet.has(bound.id))
      if (element.type === 'arrow' || element.type === 'line') {
        if (element.startBinding && removalSet.has(element.startBinding.elementId))
          updates.startBinding = null
        if (element.endBinding && removalSet.has(element.endBinding.elementId))
          updates.endBinding = null
      }
      return Object.keys(updates).length > 0 ? updateWith(element, updates) : element
    })
  // delete has a bespoke result shape (deletedIds, no receipts), so it commits
  // directly rather than through `commitWrite`.
  api.updateScene({ elements: remaining, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  return {
    ok: true as const,
    deleted: deletedIds.length,
    sceneVersion: sceneVersionOf(remaining),
    deletedIds,
    removedRelatedIds: cascadeLabelIds
  }
}

export const executeTransform = (api: ExcalidrawImperativeAPI, input: TransformInput) => {
  assertRequestBudget('transform', input)
  const { elements } = resolveScene(api, 'transform', input.expectedSceneVersion)
  const byId = elementMap(elements)
  // Preflight every requested element before mutating anything.
  for (const item of input.elements) {
    const element = byId.get(item.id)
    if (!element) throw new Error(`transform: element "${item.id}" does not exist`)
    if (element.version !== item.expectedVersion)
      throw new Error(
        `transform: element "${item.id}" is stale (expected version ${item.expectedVersion}, current version ${element.version}); read it again before retrying`
      )
    if (element.locked)
      throw new Error(
        `transform: element "${item.id}" is locked; unlock it before moving or resizing`
      )
    if (item.resize) {
      if (!['rectangle', 'ellipse', 'diamond'].includes(element.type))
        throw new Error(
          `transform: element "${item.id}" of type "${element.type}" cannot be resized`
        )
      // Resizing a bound shape distorts its connectors unless the caller opts in
      // to reflow, which re-anchors them to the moved/resized bounds afterward.
      if (!input.reflowConnectors) {
        const boundConnector =
          element.boundElements?.some((bound) => bound.type === 'arrow') ||
          elements.some(
            (other) =>
              (other.type === 'arrow' || other.type === 'line') &&
              (other.startBinding?.elementId === element.id ||
                other.endBinding?.elementId === element.id)
          )
        if (boundConnector)
          throw new Error(
            `transform: element "${item.id}" has connector bindings; resizing it would distort them (pass reflowConnectors:true to re-anchor them)`
          )
      }
    }
  }
  const baseDeltas = new Map<string, Delta>()
  for (const item of input.elements)
    if (item.move && (item.move.dx !== 0 || item.move.dy !== 0))
      baseDeltas.set(item.id, { dx: item.move.dx, dy: item.move.dy })
  // A label and its container cannot move by conflicting deltas.
  for (const element of elements)
    if (
      element.type === 'text' &&
      element.containerId &&
      baseDeltas.has(element.containerId) &&
      baseDeltas.has(element.id)
    ) {
      const container = baseDeltas.get(element.containerId)!
      const label = baseDeltas.get(element.id)!
      if (container.dx !== label.dx || container.dy !== label.dy)
        throw new Error(
          `transform: label "${element.id}" and its container move by different deltas`
        )
    }
  // A connector bound to a moved shape must move consistently or not be distorted.
  for (const element of elements) {
    if (element.type !== 'arrow' && element.type !== 'line') continue
    const startId = element.startBinding?.elementId
    const endId = element.endBinding?.elementId
    const startMoved = startId ? baseDeltas.has(startId) : false
    const endMoved = endId ? baseDeltas.has(endId) : false
    if (!startMoved && !endMoved) continue
    const startDelta = startId ? baseDeltas.get(startId) : undefined
    const endDelta = endId ? baseDeltas.get(endId) : undefined
    const consistent =
      startMoved && endMoved && startDelta!.dx === endDelta!.dx && startDelta!.dy === endDelta!.dy
    // A one-sided move would distort the connector unless the caller opts in to
    // reflow, which re-anchors the moved endpoint afterward.
    if (!consistent && !baseDeltas.has(element.id) && !input.reflowConnectors)
      throw new Error(
        `transform: connector "${element.id}" binds a moved element; move both endpoints together or pass reflowConnectors:true to re-anchor it`
      )
  }
  const moved = applyDeltas(elements, baseDeltas)
  const resizeIds = new Set(input.elements.filter((item) => item.resize).map((item) => item.id))
  let nextElements: OrderedExcalidrawElement[] = moved.nextElements
  if (resizeIds.size > 0) {
    const resizeById = new Map(
      input.elements.filter((item) => item.resize).map((item) => [item.id, item.resize!])
    )
    nextElements = nextElements.map((element) => {
      const resize = resizeById.get(element.id)
      if (!resize) return element
      const updates: Record<string, unknown> = {}
      if (resize.width !== undefined) updates.width = resize.width
      if (resize.height !== undefined) updates.height = resize.height
      return updateWith(element, updates)
    })
    // Re-center bound labels of any resized container.
    nextElements = nextElements.map((element) => {
      if (element.type !== 'text' || !element.containerId || !resizeIds.has(element.containerId))
        return element
      const container = nextElements.find((candidate) => candidate.id === element.containerId)
      if (!container) return element
      const containerBox = boxOf(container)
      const labelBox = boxOf(element)
      const dx = containerBox.cx - labelBox.width / 2 - labelBox.x1
      const dy = containerBox.cy - labelBox.height / 2 - labelBox.y1
      return dx !== 0 || dy !== 0
        ? updateWith(element, { x: element.x + dx, y: element.y + dy })
        : element
    })
  }
  // After all moves and resizes settle, re-anchor connectors bound to any shape
  // that changed so their bindings follow the new geometry.
  if (input.reflowConnectors) {
    const changedTargetIds = new Set<string>([...moved.movedIds, ...resizeIds])
    nextElements = reflowBoundConnectors(nextElements, changedTargetIds)
  }
  const changedIds = changedByIdentity(elements, nextElements)
  return commitWrite(api, nextElements, changedIds, EXCALIDRAW_PAYLOAD_BUDGETS.transform.result)
}
