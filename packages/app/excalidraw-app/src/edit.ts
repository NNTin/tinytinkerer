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
import { attachBoundedRecords, versionReceipts } from './mutation'
import { capabilitiesFor, elementMap } from './normalization'
import { assertRequestBudget } from './query'

const hasChange = (changes: EditChanges, key: keyof EditChanges) =>
  Object.prototype.hasOwnProperty.call(changes, key)

const validateEdit = (
  element: OrderedExcalidrawElement,
  changes: EditChanges,
  elements: readonly OrderedExcalidrawElement[]
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
  const byId = elementMap(elements)
  for (const edit of input.edits) {
    const element = byId.get(edit.id)
    if (!element) throw new Error(`edit: element "${edit.id}" does not exist`)
    if (element.version !== edit.expectedVersion)
      throw new Error(
        `edit: element "${edit.id}" is stale (expected version ${edit.expectedVersion}, current version ${element.version}); read it again before retrying`
      )
    validateEdit(element, edit.changes, elements)
  }
  const edits = new Map(input.edits.map((edit) => [edit.id, edit]))
  let updated = 0
  const nextElements = elements.map((element) => {
    const edit = edits.get(element.id)
    if (!edit) return element
    const next = applyChanges(element, edit.changes)
    if (next !== element) updated++
    return next
  })
  if (updated)
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })

  const ids = input.edits.map(({ id }) => id)
  const receipts = versionReceipts(nextElements, ids)
  return attachBoundedRecords(
    { ok: true as const, updated, receipts },
    nextElements,
    ids,
    EXCALIDRAW_PAYLOAD_BUDGETS.edit.result
  )
}
