import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawTextElement,
  OrderedExcalidrawElement
} from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type { EditChanges, EditInput } from '@tinytinkerer/excalidraw-protocol'
import {
  capabilitiesFor,
  elementMap,
  geometryRelationshipInfo,
  normalizeElement,
  sceneVersionOf
} from './normalization'
import { settleSerializedBytes } from './payload'
import { assertRequestBudget } from './query'

const hasChange = (changes: EditChanges, key: keyof EditChanges) =>
  Object.prototype.hasOwnProperty.call(changes, key)

const GEOMETRY_FIELDS: Array<keyof EditChanges> = ['x', 'y', 'width', 'height', 'angleDegrees']
const hasGeometryChange = (changes: EditChanges): boolean =>
  GEOMETRY_FIELDS.some((field) => hasChange(changes, field))

const checkSceneVersion = (expected: number | undefined, actual: number): void => {
  if (expected !== undefined && expected !== actual) {
    throw new Error(
      `edit: scene changed (expected scene version ${expected}, current version ${actual}); read it again before retrying`
    )
  }
}

const validateEdit = (
  element: OrderedExcalidrawElement,
  changes: EditChanges,
  elements: readonly OrderedExcalidrawElement[],
  expectedSceneVersion: number | undefined
): void => {
  const capabilities = capabilitiesFor(element, elements)
  const requested = Object.keys(changes) as Array<keyof EditChanges>
  if (element.locked && requested.some((key) => key !== 'locked') && changes.locked !== false) {
    throw new Error(
      `edit: element "${element.id}" is locked; include locked:false to explicitly unlock it`
    )
  }
  for (const field of requested) {
    if (!capabilities.editableFields.includes(field)) {
      throw new Error(
        `edit: field "${field}" is not editable for element "${element.id}" (${capabilities.restrictions.join(', ') || 'unsupported'})`
      )
    }
  }
  const relationshipInfo = geometryRelationshipInfo(element, elements)
  if (
    relationshipInfo.hasRelationship &&
    hasGeometryChange(changes) &&
    expectedSceneVersion === undefined
  ) {
    throw new Error(
      `edit: element "${element.id}" has relationships; include expectedSceneVersion so related geometry can be updated safely`
    )
  }
}

const measureText = (element: ExcalidrawTextElement, text: string) => {
  const [measured] = convertToExcalidrawElements([
    {
      type: 'text',
      x: element.x,
      y: element.y,
      text,
      fontFamily: element.fontFamily,
      fontSize: element.fontSize,
      lineHeight: element.lineHeight
    }
  ])
  if (measured?.type !== 'text') throw new Error('edit: failed to measure text')
  return {
    text: measured.text,
    originalText: measured.originalText,
    width: measured.width,
    height: measured.height
  }
}

const applyChanges = (
  element: OrderedExcalidrawElement,
  changes: EditChanges
): OrderedExcalidrawElement => {
  const updates: Record<string, unknown> = {}
  for (const key of [
    'x',
    'y',
    'width',
    'height',
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'roughness',
    'opacity',
    'locked'
  ] as const) {
    if (hasChange(changes, key)) updates[key] = changes[key]
  }
  if (hasChange(changes, 'angleDegrees'))
    updates.angle = ((changes.angleDegrees ?? 0) * Math.PI) / 180
  if (hasChange(changes, 'text') && element.type === 'text')
    Object.assign(updates, measureText(element, changes.text ?? ''))
  return newElementWith(
    element,
    updates as Parameters<typeof newElementWith<OrderedExcalidrawElement>>[1]
  )
}

export const executeEdit = (api: ExcalidrawImperativeAPI, input: EditInput) => {
  assertRequestBudget('edit', input)
  const elements = api.getSceneElements()
  checkSceneVersion(input.expectedSceneVersion, sceneVersionOf(elements))
  const byId = elementMap(elements)
  for (const edit of input.edits) {
    const element = byId.get(edit.id)
    if (!element) throw new Error(`edit: element "${edit.id}" does not exist`)
    if (element.version !== edit.expectedVersion)
      throw new Error(
        `edit: element "${edit.id}" is stale (expected version ${edit.expectedVersion}, current version ${element.version}); read it again before retrying`
      )
    validateEdit(element, edit.changes, elements, input.expectedSceneVersion)
  }
  const edits = new Map(input.edits.map((edit) => [edit.id, edit]))
  let nextElements = elements.map((element) => {
    const edit = edits.get(element.id)
    if (!edit) return element
    return applyChanges(element, edit.changes)
  })
  const nextById = elementMap(nextElements)
  const dependentDeltas = new Map<string, { dx: number; dy: number }>()
  for (const edit of input.edits) {
    const original = byId.get(edit.id)!
    const next = nextById.get(edit.id)!
    const dx = next.x - original.x
    const dy = next.y - original.y
    if (dx === 0 && dy === 0) continue
    const info = geometryRelationshipInfo(original, elements)
    for (const id of [...info.dependentTextIds, ...info.frameChildIds]) {
      const dependentEdit = edits.get(id)
      if (
        dependentEdit &&
        (hasChange(dependentEdit.changes, 'x') || hasChange(dependentEdit.changes, 'y'))
      ) {
        continue
      }
      const current = dependentDeltas.get(id) ?? { dx: 0, dy: 0 }
      dependentDeltas.set(id, { dx: current.dx + dx, dy: current.dy + dy })
    }
  }
  if (dependentDeltas.size) {
    nextElements = nextElements.map((element) => {
      const delta = dependentDeltas.get(element.id)
      if (!delta || (delta.dx === 0 && delta.dy === 0)) return element
      return newElementWith(element, { x: element.x + delta.dx, y: element.y + delta.dy })
    })
  }
  const updated = nextElements.reduce(
    (count, element, index) => count + (element === elements[index] ? 0 : 1),
    0
  )
  if (updated)
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })

  const receiptIds = [...new Set([...input.edits.map(({ id }) => id), ...dependentDeltas.keys()])]
  const receipts = receiptIds.map((id) => {
    const element = nextElements.find((candidate) => candidate.id === id)!
    return { id, version: element.version }
  })
  const truncatedFields: string[] = []
  let details = receiptIds.map((id) => {
    const index = nextElements.findIndex((element) => element.id === id)
    const normalized = normalizeElement(nextElements[index]!, index, nextElements, 'standard')
    truncatedFields.push(
      ...normalized.truncatedFields.map((field) => `${normalized.element.id}.${field}`)
    )
    return normalized.element
  })
  const budgetBytes = EXCALIDRAW_PAYLOAD_BUDGETS.edit.result
  let result = {
    ok: true as const,
    updated,
    receipts,
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
    throw new Error(`edit: compact receipts exceed the ${budgetBytes} byte payload budget`)
  }
  return result
}
