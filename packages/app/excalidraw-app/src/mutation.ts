import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ReadElement } from '@tinytinkerer/excalidraw-protocol'
import { normalizeElement, sceneVersionOf } from './normalization'
import { settleSerializedBytes, trimToBudget } from './payload'

// Shared write machinery for the mutating verbs. A write reports which elements
// changed via compact version receipts (never dropped) plus normalized
// `read`-shaped records trimmed to a byte budget, and commits exactly one atomic,
// undoable scene update. Edits, structural verbs, binding, and layout all share
// this so the write invariant and truncation policy live once.

export type ResultTruncation = {
  truncated: boolean
  fields: string[]
  omittedElements: number
  serializedBytes: number
  budgetBytes: number
}

// The ids of elements a rebuild actually replaced (identity changed at their index
// because `updateWith` returns the same object when nothing changed). The common
// "which elements changed" diff for verbs that map the whole scene array.
export const changedByIdentity = (
  elements: readonly OrderedExcalidrawElement[],
  nextElements: readonly OrderedExcalidrawElement[]
): string[] =>
  nextElements.filter((element, index) => element !== elements[index]).map((element) => element.id)

export const versionReceipts = (
  nextElements: readonly OrderedExcalidrawElement[],
  ids: readonly string[]
): Array<{ id: string; version: number }> =>
  ids.map((id) => {
    const element = nextElements.find((candidate) => candidate.id === id)
    if (!element) throw new Error(`receipt: element "${id}" is missing after the update`)
    return { id, version: element.version }
  })

export const attachBoundedRecords = <TBase extends object>(
  base: TBase,
  nextElements: readonly OrderedExcalidrawElement[],
  recordIds: readonly string[],
  budgetBytes: number
): TBase & { elements: ReadElement[]; truncation: ResultTruncation } => {
  const fields: string[] = []
  const all = recordIds.map((id) => {
    const index = nextElements.findIndex((element) => element.id === id)
    const normalized = normalizeElement(nextElements[index]!, index, nextElements, 'standard')
    fields.push(...normalized.truncatedFields.map((field) => `${normalized.element.id}.${field}`))
    return normalized.element
  })
  // Drop trailing detailed records until the serialized result fits; receipts stay.
  return trimToBudget(
    (count) => {
      const elements = all.slice(0, count)
      const result: TBase & { elements: ReadElement[]; truncation: ResultTruncation } = {
        ...base,
        elements,
        truncation: {
          truncated: fields.length > 0 || count < all.length,
          fields: [...new Set(fields)],
          omittedElements: all.length - count,
          serializedBytes: 0,
          budgetBytes
        }
      }
      settleSerializedBytes(result)
      return result
    },
    all.length,
    budgetBytes
  )
}

// The single write choke-point: commit exactly one atomic, undoable `updateScene`
// when something changed (an empty change set is a no-op), then return the shared
// receipt + budget-bounded records. `extra` carries verb-specific result fields
// (e.g. bind's connector state, group's operation/groupId).
export const commitWrite = <TExtra extends object>(
  api: ExcalidrawImperativeAPI,
  nextElements: readonly OrderedExcalidrawElement[],
  changedIds: readonly string[],
  resultBudget: number,
  extra?: TExtra
) => {
  if (changedIds.length > 0)
    api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  return attachBoundedRecords(
    {
      ok: true as const,
      updated: changedIds.length,
      sceneVersion: sceneVersionOf(nextElements),
      receipts: versionReceipts(nextElements, changedIds),
      ...(extra ?? ({} as TExtra))
    },
    nextElements,
    changedIds,
    resultBudget
  )
}
