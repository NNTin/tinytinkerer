import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ReadElement } from '@tinytinkerer/excalidraw-protocol'
import { normalizeElement } from './normalization'
import { settleSerializedBytes } from './payload'

// Shared receipt + budget machinery for write verbs. A mutation reports which
// elements changed via compact version receipts (never dropped) plus normalized
// `read`-shaped records, and the records are trimmed from the tail until the
// serialized result fits its byte budget. Reads, edits, and structural verbs all
// share this one truncation policy.

export type ResultTruncation = {
  truncated: boolean
  fields: string[]
  omittedElements: number
  serializedBytes: number
  budgetBytes: number
}

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
  let elements = all
  let result: TBase & { elements: ReadElement[]; truncation: ResultTruncation } = {
    ...base,
    elements,
    truncation: {
      truncated: fields.length > 0,
      fields: [...new Set(fields)],
      omittedElements: 0,
      serializedBytes: 0,
      budgetBytes
    }
  }
  settleSerializedBytes(result)
  while (result.truncation.serializedBytes > budgetBytes && elements.length) {
    elements = elements.slice(0, -1)
    result = {
      ...result,
      elements,
      truncation: {
        ...result.truncation,
        truncated: true,
        omittedElements: all.length - elements.length
      }
    }
    settleSerializedBytes(result)
  }
  settleSerializedBytes(result)
  if (result.truncation.serializedBytes > budgetBytes)
    throw new Error(`result records exceed the ${budgetBytes} byte payload budget`)
  return result
}
