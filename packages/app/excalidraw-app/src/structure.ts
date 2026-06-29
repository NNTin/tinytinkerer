import { CaptureUpdateAction, getCommonBounds, newElementWith } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  EXCALIDRAW_PAYLOAD_BUDGETS,
  type AlignInput,
  type DeleteInput,
  type DistributeInput,
  type DuplicateInput,
  type GroupInput,
  type ReorderInput,
  type StackInput,
  type UngroupInput,
  type VersionedElementRef
} from '@tinytinkerer/excalidraw-protocol'
import {
  elementMap,
  geometryRelationshipInfo,
  normalizeElement,
  sceneVersionOf
} from './normalization'
import { serializedUtf8Bytes, settleSerializedBytes } from './payload'
import { assertRequestBudget } from './query'

type StructuralVerb =
  | 'group'
  | 'ungroup'
  | 'duplicate'
  | 'delete'
  | 'align'
  | 'distribute'
  | 'stack'
  | 'reorder'

type Bounds = {
  start: number
  end: number
  center: number
  extent: number
  x: number
  y: number
  width: number
  height: number
}

const randomSuffix = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const uniqueId = (prefix: string, used: Set<string>): string => {
  let id: string
  do {
    id = `${prefix}-${randomSuffix()}`
  } while (used.has(id))
  used.add(id)
  return id
}

const randomNonce = (): number => Math.floor(Math.random() * 2_147_483_647)

const cloneJson = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)

const checkSceneVersion = (verb: StructuralVerb, expected: number, actual: number): void => {
  if (expected !== actual) {
    throw new Error(
      `${verb}: scene changed (expected scene version ${expected}, current version ${actual}); read it again before retrying`
    )
  }
}

const resolveVersionedRefs = (
  verb: StructuralVerb,
  elements: readonly OrderedExcalidrawElement[],
  expectedSceneVersion: number,
  refs: readonly VersionedElementRef[]
): OrderedExcalidrawElement[] => {
  checkSceneVersion(verb, expectedSceneVersion, sceneVersionOf(elements))
  const byId = elementMap(elements)
  return refs.map((ref) => {
    const element = byId.get(ref.id)
    if (!element) throw new Error(`${verb}: element "${ref.id}" does not exist`)
    if (element.version !== ref.expectedVersion) {
      throw new Error(
        `${verb}: element "${ref.id}" is stale (expected version ${ref.expectedVersion}, current version ${element.version}); read it again before retrying`
      )
    }
    return element
  })
}

const boundsFor = (element: OrderedExcalidrawElement, axis: 'x' | 'y'): Bounds => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  const x = x1
  const y = y1
  const width = x2 - x1
  const height = y2 - y1
  const start = axis === 'x' ? x : y
  const extent = axis === 'x' ? width : height
  return { start, end: start + extent, center: start + extent / 2, extent, x, y, width, height }
}

const commonBounds = (elements: readonly OrderedExcalidrawElement[], axis: 'x' | 'y'): Bounds => {
  const [x1, y1, x2, y2] = getCommonBounds([...elements])
  const x = x1
  const y = y1
  const width = x2 - x1
  const height = y2 - y1
  const start = axis === 'x' ? x : y
  const extent = axis === 'x' ? width : height
  return { start, end: start + extent, center: start + extent / 2, extent, x, y, width, height }
}

const addDelta = (
  deltas: Map<string, { dx: number; dy: number }>,
  id: string,
  dx: number,
  dy: number
): void => {
  if (dx === 0 && dy === 0) return
  const current = deltas.get(id) ?? { dx: 0, dy: 0 }
  deltas.set(id, { dx: current.dx + dx, dy: current.dy + dy })
}

const addRelationshipAwareDelta = (
  verb: StructuralVerb,
  deltas: Map<string, { dx: number; dy: number }>,
  element: OrderedExcalidrawElement,
  elements: readonly OrderedExcalidrawElement[],
  explicitIds: ReadonlySet<string>,
  dx: number,
  dy: number
): void => {
  if (dx === 0 && dy === 0) return
  const info = geometryRelationshipInfo(element, elements)
  if (info.hasUnsafeGeometry) {
    throw new Error(
      `${verb}: element "${element.id}" has relationship-geometry that cannot be moved without connector/binding handling`
    )
  }
  addDelta(deltas, element.id, dx, dy)
  for (const id of [...info.dependentTextIds, ...info.frameChildIds]) {
    if (!explicitIds.has(id)) addDelta(deltas, id, dx, dy)
  }
}

const applyDeltas = (
  elements: readonly OrderedExcalidrawElement[],
  deltas: ReadonlyMap<string, { dx: number; dy: number }>
): OrderedExcalidrawElement[] =>
  elements.map((element) => {
    const delta = deltas.get(element.id)
    if (!delta) return element
    return newElementWith(element, { x: element.x + delta.dx, y: element.y + delta.dy })
  })

const updateSceneIfChanged = (
  api: ExcalidrawImperativeAPI,
  previous: readonly OrderedExcalidrawElement[],
  next: readonly OrderedExcalidrawElement[]
): number => {
  const updated = next.reduce(
    (count, element, index) => count + (element === previous[index] ? 0 : 1),
    0
  )
  if (updated) {
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  }
  return updated
}

const mutationResult = <TExtra extends Record<string, unknown> = Record<string, never>>(
  verb: Exclude<StructuralVerb, 'delete' | 'reorder'>,
  elements: readonly OrderedExcalidrawElement[],
  receiptIds: readonly string[],
  updated: number,
  extra: TExtra = {} as TExtra
) => {
  const byId = elementMap(elements)
  const receipts = receiptIds.map((id) => {
    const element = byId.get(id)
    if (!element) throw new Error(`${verb}: receipt element "${id}" does not exist`)
    return { id, version: element.version }
  })
  const truncatedFields: string[] = []
  let details = receiptIds.map((id) => {
    const index = elements.findIndex((element) => element.id === id)
    const normalized = normalizeElement(elements[index]!, index, elements, 'standard')
    truncatedFields.push(
      ...normalized.truncatedFields.map((field) => `${normalized.element.id}.${field}`)
    )
    return normalized.element
  })
  const budgetBytes = EXCALIDRAW_PAYLOAD_BUDGETS[verb].result
  let result = {
    ok: true as const,
    updated,
    receipts,
    ...extra,
    elements: details,
    truncation: {
      truncated: truncatedFields.length > 0,
      fields: truncatedFields,
      omittedElements: 0,
      serializedBytes: 0,
      budgetBytes
    }
  }
  settleSerializedBytes(result)
  while (result.truncation.serializedBytes > budgetBytes && details.length) {
    details = details.slice(0, -1)
    result = {
      ...result,
      elements: details,
      truncation: {
        ...result.truncation,
        truncated: true,
        omittedElements: receipts.length - details.length
      }
    }
    settleSerializedBytes(result)
  }
  settleSerializedBytes(result)
  if (result.truncation.serializedBytes > budgetBytes) {
    throw new Error(`${verb}: compact receipts exceed the ${budgetBytes} byte payload budget`)
  }
  return result
}

const relatedTextIds = (
  ids: ReadonlySet<string>,
  elements: readonly OrderedExcalidrawElement[]
): string[] => {
  const expanded = new Set(ids)
  for (const element of elements) {
    if (!ids.has(element.id)) continue
    for (const id of geometryRelationshipInfo(element, elements).dependentTextIds) {
      expanded.add(id)
    }
  }
  return [...expanded]
}

const relationshipReferences = (element: OrderedExcalidrawElement): string[] => {
  const references = [
    element.frameId,
    ...(element.boundElements ?? []).map(({ id }) => id),
    element.type === 'text' ? element.containerId : null,
    element.type === 'line' || element.type === 'arrow' ? element.startBinding?.elementId : null,
    element.type === 'line' || element.type === 'arrow' ? element.endBinding?.elementId : null
  ]
  return references.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

const expandDeletion = (
  ids: ReadonlySet<string>,
  elements: readonly OrderedExcalidrawElement[]
): Set<string> => {
  const expanded = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const element of elements) {
      if (expanded.has(element.id)) continue
      if (relationshipReferences(element).some((id) => expanded.has(id))) {
        expanded.add(element.id)
        changed = true
      }
    }
  }
  return expanded
}

const assertNoRelationshipCrossing = (
  verb: StructuralVerb,
  ids: ReadonlySet<string>,
  elements: readonly OrderedExcalidrawElement[]
): void => {
  for (const element of elements) {
    for (const reference of relationshipReferences(element)) {
      if (ids.has(element.id) !== ids.has(reference)) {
        throw new Error(
          `${verb}: element "${element.id}" has a relationship with "${reference}"; include related elements or enable includeRelated`
        )
      }
    }
  }
}

const duplicateIds = (
  ids: ReadonlySet<string>,
  elements: readonly OrderedExcalidrawElement[]
): Set<string> => {
  const expanded = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const element of elements) {
      if (expanded.has(element.id)) {
        if (element.type === 'line' || element.type === 'arrow') {
          if (element.startBinding || element.endBinding) {
            throw new Error(
              `duplicate: element "${element.id}" has linear bindings; connector duplication is outside this editing slice`
            )
          }
        }
        for (const bound of element.boundElements ?? []) {
          if (bound.type === 'arrow') {
            throw new Error(
              `duplicate: element "${element.id}" has bound arrows; connector duplication is outside this editing slice`
            )
          }
          if (!expanded.has(bound.id)) {
            expanded.add(bound.id)
            changed = true
          }
        }
      } else if (
        (element.type === 'text' && element.containerId && expanded.has(element.containerId)) ||
        (element.frameId && expanded.has(element.frameId))
      ) {
        expanded.add(element.id)
        changed = true
      }
    }
  }
  return expanded
}

const cloneElement = (
  element: OrderedExcalidrawElement,
  id: string,
  offsetX: number,
  offsetY: number,
  idMap: ReadonlyMap<string, string>,
  groupIdMap: Map<string, string>
): OrderedExcalidrawElement => {
  const copy = cloneJson(element)
  const mapGroup = (groupId: string) => {
    const existing = groupIdMap.get(groupId)
    if (existing) return existing
    const next = `tt-group-${randomSuffix()}`
    groupIdMap.set(groupId, next)
    return next
  }
  Object.assign(copy, {
    id,
    x: element.x + offsetX,
    y: element.y + offsetY,
    version: 1,
    versionNonce: randomNonce(),
    updated: Date.now(),
    seed: randomNonce(),
    groupIds: element.groupIds.map(mapGroup),
    frameId:
      element.frameId && idMap.has(element.frameId) ? idMap.get(element.frameId)! : element.frameId,
    boundElements:
      element.boundElements === null
        ? null
        : element.boundElements?.map((bound) => ({
            ...bound,
            id: idMap.get(bound.id) ?? bound.id
          }))
  })
  if (copy.type === 'text' && copy.containerId && idMap.has(copy.containerId)) {
    Object.assign(copy, { containerId: idMap.get(copy.containerId)! })
  }
  return copy
}

export const executeGroup = (api: ExcalidrawImperativeAPI, input: GroupInput) => {
  assertRequestBudget('group', input)
  const elements = api.getSceneElements()
  resolveVersionedRefs('group', elements, input.expectedSceneVersion, input.elements)
  const explicitIds = new Set(input.elements.map(({ id }) => id))
  const ids = relatedTextIds(explicitIds, elements)
  const groupId = input.groupId ?? uniqueId('tt-group', new Set(ids))
  const idSet = new Set(ids)
  const nextElements = elements.map((element) => {
    if (!idSet.has(element.id) || element.groupIds.includes(groupId)) return element
    return newElementWith(element, { groupIds: [...element.groupIds, groupId] })
  })
  const updated = updateSceneIfChanged(api, elements, nextElements)
  return mutationResult('group', nextElements, ids, updated, { groupId })
}

export const executeUngroup = (api: ExcalidrawImperativeAPI, input: UngroupInput) => {
  assertRequestBudget('ungroup', input)
  const elements = api.getSceneElements()
  resolveVersionedRefs('ungroup', elements, input.expectedSceneVersion, input.elements)
  const explicitIds = new Set(input.elements.map(({ id }) => id))
  const ids = relatedTextIds(explicitIds, elements)
  const removedGroupIds = new Set<string>()
  const idSet = new Set(ids)
  const nextElements = elements.map((element) => {
    if (!idSet.has(element.id) || element.groupIds.length === 0) return element
    let groupIds: string[]
    if (input.mode === 'all') {
      groupIds = input.groupId
        ? element.groupIds.filter((groupId) => groupId !== input.groupId)
        : []
      for (const groupId of element.groupIds) {
        if (!input.groupId || groupId === input.groupId) removedGroupIds.add(groupId)
      }
    } else {
      const groupId = input.groupId ?? element.groupIds[element.groupIds.length - 1]
      if (!groupId) return element
      groupIds = element.groupIds.filter((candidate) => candidate !== groupId)
      removedGroupIds.add(groupId)
    }
    return groupIds.length === element.groupIds.length
      ? element
      : newElementWith(element, { groupIds })
  })
  const updated = updateSceneIfChanged(api, elements, nextElements)
  return mutationResult('ungroup', nextElements, ids, updated, {
    removedGroupIds: [...removedGroupIds]
  })
}

export const executeDuplicate = (api: ExcalidrawImperativeAPI, input: DuplicateInput) => {
  assertRequestBudget('duplicate', input)
  const elements = api.getSceneElements()
  resolveVersionedRefs('duplicate', elements, input.expectedSceneVersion, input.elements)
  const requestedIds = new Set(input.elements.map(({ id }) => id))
  const sourceIds = input.includeRelated ? duplicateIds(requestedIds, elements) : requestedIds
  if (!input.includeRelated) assertNoRelationshipCrossing('duplicate', sourceIds, elements)
  const usedIds = new Set(elements.map(({ id }) => id))
  const idMap = new Map([...sourceIds].map((id) => [id, uniqueId('tt-copy', usedIds)]))
  const groupIdMap = new Map<string, string>()
  const sourceElements = elements.filter((element) => sourceIds.has(element.id))
  const copies = sourceElements.map((element) =>
    cloneElement(element, idMap.get(element.id)!, input.offsetX, input.offsetY, idMap, groupIdMap)
  )
  const nextElements = [...elements, ...copies]
  if (copies.length) {
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    api.scrollToContent(copies, { fitToContent: true })
  }
  const copySources = new Map(copies.map((copy, index) => [copy.id, sourceElements[index]!.id]))
  const copyReceipts = copies.map((copy) => ({
    sourceId: copySources.get(copy.id)!,
    id: copy.id,
    version: copy.version
  }))
  const result = mutationResult(
    'duplicate',
    nextElements,
    copies.map(({ id }) => id),
    copies.length,
    { duplicated: copies.length, copies: copyReceipts }
  )
  return {
    ...result,
    receipts: result.receipts.map((receipt) => ({
      ...receipt,
      sourceId: copySources.get(receipt.id)!
    }))
  }
}

export const executeDelete = (api: ExcalidrawImperativeAPI, input: DeleteInput) => {
  assertRequestBudget('delete', input)
  const elements = api.getSceneElements()
  resolveVersionedRefs('delete', elements, input.expectedSceneVersion, input.elements)
  const requestedIds = new Set(input.elements.map(({ id }) => id))
  const ids = input.includeRelated ? expandDeletion(requestedIds, elements) : requestedIds
  if (!input.includeRelated) assertNoRelationshipCrossing('delete', ids, elements)
  const nextElements = elements.filter((element) => !ids.has(element.id))
  if (nextElements.length !== elements.length) {
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  }
  const result = {
    ok: true as const,
    deleted: elements.length - nextElements.length,
    deletedIds: [...ids]
  }
  const budget = EXCALIDRAW_PAYLOAD_BUDGETS.delete.result
  const size = serializedUtf8Bytes(result)
  if (size > budget) throw new Error(`delete: result exceeds the ${budget} byte payload budget`)
  return result
}

export const executeAlign = (api: ExcalidrawImperativeAPI, input: AlignInput) => {
  assertRequestBudget('align', input)
  const elements = api.getSceneElements()
  const targets = resolveVersionedRefs(
    'align',
    elements,
    input.expectedSceneVersion,
    input.elements
  )
  const explicitIds = new Set(targets.map(({ id }) => id))
  const selection = commonBounds(targets, input.axis)
  const deltas = new Map<string, { dx: number; dy: number }>()
  for (const element of targets) {
    const bounds = boundsFor(element, input.axis)
    const delta =
      input.position === 'start'
        ? selection.start - bounds.start
        : input.position === 'end'
          ? selection.end - bounds.end
          : selection.center - bounds.center
    addRelationshipAwareDelta(
      'align',
      deltas,
      element,
      elements,
      explicitIds,
      input.axis === 'x' ? delta : 0,
      input.axis === 'y' ? delta : 0
    )
  }
  const nextElements = applyDeltas(elements, deltas)
  const updated = updateSceneIfChanged(api, elements, nextElements)
  return mutationResult('align', nextElements, [...deltas.keys()], updated)
}

export const executeDistribute = (api: ExcalidrawImperativeAPI, input: DistributeInput) => {
  assertRequestBudget('distribute', input)
  const elements = api.getSceneElements()
  const targets = resolveVersionedRefs(
    'distribute',
    elements,
    input.expectedSceneVersion,
    input.elements
  )
  if (targets.length < 3) {
    return mutationResult(
      'distribute',
      elements,
      targets.map(({ id }) => id),
      0
    )
  }
  const explicitIds = new Set(targets.map(({ id }) => id))
  const ordered = [...targets].sort(
    (a, b) => boundsFor(a, input.axis).center - boundsFor(b, input.axis).center
  )
  const selection = commonBounds(ordered, input.axis)
  const bounds = ordered.map((element) => boundsFor(element, input.axis))
  const span = bounds.reduce((total, box) => total + box.extent, 0)
  const gap = (selection.extent - span) / (ordered.length - 1)
  const deltas = new Map<string, { dx: number; dy: number }>()
  if (gap >= 0) {
    let position = selection.start
    ordered.forEach((element, index) => {
      const delta = position - bounds[index]!.start
      addRelationshipAwareDelta(
        'distribute',
        deltas,
        element,
        elements,
        explicitIds,
        input.axis === 'x' ? delta : 0,
        input.axis === 'y' ? delta : 0
      )
      position += bounds[index]!.extent + gap
    })
  } else {
    const first = bounds[0]!
    const last = bounds[bounds.length - 1]!
    const step = (last.center - first.center) / (ordered.length - 1)
    ordered.forEach((element, index) => {
      const delta = first.center + step * index - bounds[index]!.center
      addRelationshipAwareDelta(
        'distribute',
        deltas,
        element,
        elements,
        explicitIds,
        input.axis === 'x' ? delta : 0,
        input.axis === 'y' ? delta : 0
      )
    })
  }
  const nextElements = applyDeltas(elements, deltas)
  const updated = updateSceneIfChanged(api, elements, nextElements)
  return mutationResult('distribute', nextElements, [...deltas.keys()], updated)
}

export const executeStack = (api: ExcalidrawImperativeAPI, input: StackInput) => {
  assertRequestBudget('stack', input)
  const elements = api.getSceneElements()
  const targets = resolveVersionedRefs(
    'stack',
    elements,
    input.expectedSceneVersion,
    input.elements
  )
  if (targets.length < 2)
    return mutationResult(
      'stack',
      elements,
      targets.map(({ id }) => id),
      0
    )
  const explicitIds = new Set(targets.map(({ id }) => id))
  const ordered =
    input.order === 'position'
      ? [...targets].sort((a, b) => boundsFor(a, input.axis).start - boundsFor(b, input.axis).start)
      : targets
  const deltas = new Map<string, { dx: number; dy: number }>()
  let nextStart = boundsFor(ordered[0]!, input.axis).end + input.spacing
  for (const element of ordered.slice(1)) {
    const bounds = boundsFor(element, input.axis)
    const delta = nextStart - bounds.start
    addRelationshipAwareDelta(
      'stack',
      deltas,
      element,
      elements,
      explicitIds,
      input.axis === 'x' ? delta : 0,
      input.axis === 'y' ? delta : 0
    )
    nextStart += bounds.extent + input.spacing
  }
  const nextElements = applyDeltas(elements, deltas)
  const updated = updateSceneIfChanged(api, elements, nextElements)
  return mutationResult('stack', nextElements, [...deltas.keys()], updated)
}

export const executeReorder = (api: ExcalidrawImperativeAPI, input: ReorderInput) => {
  assertRequestBudget('reorder', input)
  const elements = api.getSceneElements()
  resolveVersionedRefs('reorder', elements, input.expectedSceneVersion, input.elements)
  const ids = new Set(input.elements.map(({ id }) => id))
  let nextElements = [...elements]
  if (input.direction === 'front' || input.direction === 'back') {
    const moved = nextElements.filter((element) => ids.has(element.id))
    const rest = nextElements.filter((element) => !ids.has(element.id))
    nextElements = input.direction === 'front' ? [...rest, ...moved] : [...moved, ...rest]
  } else if (input.direction === 'forward') {
    for (let index = nextElements.length - 2; index >= 0; index--) {
      if (ids.has(nextElements[index]!.id) && !ids.has(nextElements[index + 1]!.id)) {
        const current = nextElements[index]!
        nextElements[index] = nextElements[index + 1]!
        nextElements[index + 1] = current
      }
    }
  } else {
    for (let index = 1; index < nextElements.length; index++) {
      if (ids.has(nextElements[index]!.id) && !ids.has(nextElements[index - 1]!.id)) {
        const current = nextElements[index]!
        nextElements[index] = nextElements[index - 1]!
        nextElements[index - 1] = current
      }
    }
  }
  const moved = input.elements.filter(({ id }) => {
    const before = elements.findIndex((element) => element.id === id)
    const after = nextElements.findIndex((element) => element.id === id)
    return before !== after
  }).length
  if (moved) {
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  }
  const result = {
    ok: true as const,
    moved,
    zOrder: nextElements.map(({ id }) => id)
  }
  const budget = EXCALIDRAW_PAYLOAD_BUDGETS.reorder.result
  const size = serializedUtf8Bytes(result)
  if (size > budget) throw new Error(`reorder: result exceeds the ${budget} byte payload budget`)
  return result
}
