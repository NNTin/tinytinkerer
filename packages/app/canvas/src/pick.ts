import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_ELEMENT_LIMIT, EXCALIDRAW_PAYLOAD_BUDGETS } from './inputs'
import type { PickInput } from './inputs'
import {
  normalizeElement,
  projectElement,
  sceneVersionOf,
  truncationSurvivesProjection
} from './normalization'
import { settleSerializedBytes, trimToBudget } from './payload'
import { assertRequestBudget } from './query'

// `pick` is the interactive/selection read: `current` reports the live selection
// now; `interactive` shows an in-canvas toast and waits for the user's next
// settled selection (or times out). One stage = one user, so only one
// interactive pick may be in flight at a time.
let interactivePickPending = false

// A marquee drag emits a stream of selection-change events; resolve only after
// the selection has been stable for this long.
export const PICK_SETTLE_MS = 300

// Scene-order ids of elements whose id is in the live selection. This silently
// drops deleted/stale selection ids — the "selection of deleted elements" edge
// case — since it only keeps ids that still exist in the current scene.
const liveSelectedIds = (
  elements: readonly OrderedExcalidrawElement[],
  state: ReturnType<ExcalidrawImperativeAPI['getAppState']>
): string[] => {
  const selected = new Set(Object.keys(state.selectedElementIds))
  return elements.filter((element) => selected.has(element.id)).map((element) => element.id)
}

const buildResult = (api: ExcalidrawImperativeAPI, input: PickInput, timedOut: boolean) => {
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  const state = api.getAppState()
  const liveIds = liveSelectedIds(elements, state)
  const cappedIds = liveIds.slice(0, EXCALIDRAW_ELEMENT_LIMIT)
  const fields: string[] = []
  if (cappedIds.length < liveIds.length) fields.push('selection.elementIds')

  const indices = new Map(elements.map((element, index) => [element.id, index]))
  // Bespoke record build (not attachBoundedRecords, which is hardwired to
  // 'standard' detail): normalize the capped, live selected elements at the
  // caller's requested detail level, then project down to `input.fields` if the
  // caller asked for a lean projection.
  const all = cappedIds.map((id) => {
    const index = indices.get(id)!
    const normalized = normalizeElement(elements[index]!, index, elements, input.detail)
    // Only report truncation for fields that survive the projection — a truncated
    // `text.text` on a record whose projection excludes `text` was never sent.
    const truncatedFields = input.fields
      ? normalized.truncatedFields.filter((field) =>
          truncationSurvivesProjection(field, input.fields!)
        )
      : normalized.truncatedFields
    fields.push(...truncatedFields.map((field) => `${normalized.element.id}.${field}`))
    return input.fields ? projectElement(normalized.element, input.fields) : normalized.element
  })

  const base = {
    ok: true as const,
    mode: input.mode,
    timedOut,
    detail: input.detail,
    sceneVersion,
    selectedCount: liveIds.length,
    selection: {
      elementIds: cappedIds,
      groupIds: Object.keys(state.selectedGroupIds),
      editingGroupId: state.editingGroupId
    },
    ...(input.fields ? { fields: input.fields } : {})
  }

  return trimToBudget(
    (count) => {
      const elementRecords = all.slice(0, count)
      const candidate = {
        ...base,
        elements: elementRecords,
        truncation: {
          truncated: fields.length > 0 || elementRecords.length < all.length,
          fields: [...new Set(fields)],
          omittedElements: all.length - elementRecords.length,
          serializedBytes: 0,
          budgetBytes: EXCALIDRAW_PAYLOAD_BUDGETS.pick.result
        }
      }
      settleSerializedBytes(candidate)
      return candidate
    },
    all.length,
    EXCALIDRAW_PAYLOAD_BUDGETS.pick.result
  )
}

export const executePick = async (api: ExcalidrawImperativeAPI, input: PickInput) => {
  assertRequestBudget('pick', input)
  if (input.mode === 'current') return buildResult(api, input, false)

  // Guard first, synchronously, so a second concurrent interactive pick rejects
  // immediately instead of silently queuing behind the first.
  if (interactivePickPending)
    throw new Error('pick: an interactive pick is already waiting for the user')
  interactivePickPending = true

  return new Promise<ReturnType<typeof buildResult>>((resolve, reject) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null

    // Cleanup runs on every exit path (settle, timeout, or a throwing
    // buildResult): unsubscribe, clear both timers, dismiss the toast, and free
    // the single-pending slot.
    const cleanup = (): void => {
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(timeoutTimer)
      unsubscribe?.()
      api.setToast(null)
      interactivePickPending = false
    }

    const settle = (timedOut: boolean): void => {
      try {
        resolve(buildResult(api, input, timedOut))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        cleanup()
      }
    }

    const initialIds = new Set(liveSelectedIds(api.getSceneElements(), api.getAppState()))

    api.setToast({
      message: input.prompt ?? 'Select element(s) on the canvas',
      closable: true,
      duration: input.timeoutSeconds * 1000
    })

    // The scene is re-read fresh (rather than trusting the callback's `elements`
    // argument, which may include deleted elements) but the appState argument is
    // used directly — it is already the current one.
    unsubscribe = api.onChange((_elements, appState) => {
      const currentIds = liveSelectedIds(api.getSceneElements(), appState)
      if (currentIds.length === 0) {
        if (settleTimer) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
        return
      }
      const changed =
        currentIds.length !== initialIds.size || currentIds.some((id) => !initialIds.has(id))
      if (!changed) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => settle(false), PICK_SETTLE_MS)
    })

    const timeoutTimer = setTimeout(() => settle(true), input.timeoutSeconds * 1000)
  })
}
