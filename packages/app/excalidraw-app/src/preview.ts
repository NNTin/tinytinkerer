import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  EXCALIDRAW_FIELD_LIMITS,
  EXCALIDRAW_PAYLOAD_BUDGETS,
  excalidrawVerbInputSchemas
} from '@tinytinkerer/excalidraw-protocol'
import type { PatchChange, PreviewableVerb, PreviewInput } from '@tinytinkerer/excalidraw-protocol'
import { executeBind } from './binding'
import { executeClear, executeDraw } from './create'
import { executeEdit } from './edit'
import { executeArrange, executePlace, executeSnap } from './layout'
import { displayNameFor, elementMap, sceneVersionOf } from './normalization'
import { settleSerializedBytes, trimToBudget, truncateUtf8 } from './payload'
import { executeIcon, executePreset } from './presets'
import { assertRequestBudget } from './query'
import {
  executeAlign,
  executeDelete,
  executeDistribute,
  executeDuplicate,
  executeGroup,
  executeOrder,
  executeStack,
  executeTransform
} from './structure'

// `preview` dry-runs any other mutating verb (see the rationale on the input
// schema): it runs the target verb's REAL executor — same validation, same
// geometry — against a capture wrapper that records what would have been
// committed instead of committing it, then diffs before/after into a compact
// patch summary. No staged-mutation state is held anywhere; the versioned input
// the caller passes IS the staged plan, and "apply" is just calling the target
// verb again with that same input.

// Thin dispatch table over the real executors. The cast on each input is safe
// because the caller's `input.input` was parsed against that verb's own schema
// first (see `executePreview` step 2) before we ever get here.
const dispatch: Record<PreviewableVerb, (api: ExcalidrawImperativeAPI, input: never) => unknown> = {
  draw: executeDraw,
  edit: executeEdit,
  clear: executeClear,
  group: executeGroup,
  duplicate: executeDuplicate,
  delete: executeDelete,
  align: executeAlign,
  distribute: executeDistribute,
  stack: executeStack,
  order: executeOrder,
  transform: executeTransform,
  bind: executeBind,
  snap: executeSnap,
  place: executePlace,
  arrange: executeArrange,
  preset: executePreset,
  icon: executeIcon
}

// A capture wrapper over the real imperative API: `updateScene` records the
// elements it would have committed instead of committing them, and
// `scrollToContent` is a no-op (a dry-run must not move the viewport either).
// Every other property (getSceneElements, getAppState, getFiles, ...) delegates
// straight through via `Reflect.get`, so the executor's real reads — and its
// real validation (stale versions, locks, relationship guards) — behave exactly
// as they would for a real apply; only the single commit choke-point is
// suppressed.
const buildCapture = (
  api: ExcalidrawImperativeAPI
): {
  proxy: ExcalidrawImperativeAPI
  captured: () => readonly OrderedExcalidrawElement[] | null
} => {
  let captured: readonly OrderedExcalidrawElement[] | null = null
  const handler: ProxyHandler<ExcalidrawImperativeAPI> = {
    get(target, prop, receiver): unknown {
      if (prop === 'updateScene')
        return (sceneData: { elements?: readonly OrderedExcalidrawElement[] }) => {
          if (sceneData.elements) captured = sceneData.elements
        }
      if (prop === 'scrollToContent') return () => {}
      return Reflect.get(target, prop, receiver)
    }
  }
  const proxy = new Proxy(api, handler)
  return { proxy, captured: () => captured }
}

const boundedLabel = (name: string | undefined): { label?: string; truncated: boolean } => {
  if (!name) return { truncated: false }
  const label = truncateUtf8(name, EXCALIDRAW_FIELD_LIMITS.name)
  return { label, truncated: label !== name }
}

// Diff `before`/`after` by id + object identity: executors return the same
// object for an element they didn't touch (the same trick `changedByIdentity`
// uses), so an identity change is exactly the set of elements the dry-run would
// have written. A pure z-reorder (`order`, or the regrouping shuffle in `group`)
// moves elements WITHOUT touching them, so identity alone would report nothing;
// when the id set is unchanged, an element whose array position (its z-index)
// changed is reported as an update too. Order: adds in after-array order, then
// updates in after-array order, then deletes in before-array order.
const buildChanges = (
  before: readonly OrderedExcalidrawElement[],
  after: readonly OrderedExcalidrawElement[]
): { changes: PatchChange[]; fields: string[] } => {
  const beforeMap = elementMap(before)
  const afterMap = elementMap(after)
  // Position changes are only meaningful when nothing was added or removed —
  // an insert/delete shifts every later index without changing any z-order
  // relative to the surviving elements.
  const sameIdSet =
    before.length === after.length && after.every((element) => beforeMap.has(element.id))
  const beforeIndex = new Map(before.map((element, index) => [element.id, index]))
  const fields: string[] = []
  const adds: PatchChange[] = []
  const updates: PatchChange[] = []
  for (const [index, element] of after.entries()) {
    const prior = beforeMap.get(element.id)
    if (!prior) {
      const { label, truncated } = boundedLabel(displayNameFor(element, afterMap))
      if (truncated) fields.push(`${element.id}.label`)
      adds.push({ op: 'add', id: element.id, type: element.type, ...(label ? { label } : {}) })
    } else if (prior !== element || (sameIdSet && beforeIndex.get(element.id) !== index)) {
      const { label, truncated } = boundedLabel(displayNameFor(element, afterMap))
      if (truncated) fields.push(`${element.id}.label`)
      updates.push({
        op: 'update',
        id: element.id,
        type: element.type,
        ...(label ? { label } : {}),
        version: prior.version
      })
    }
  }
  const deletes: PatchChange[] = []
  for (const element of before) {
    if (afterMap.has(element.id)) continue
    const { label, truncated } = boundedLabel(displayNameFor(element, beforeMap))
    if (truncated) fields.push(`${element.id}.label`)
    deletes.push({
      op: 'delete',
      id: element.id,
      type: element.type,
      ...(label ? { label } : {}),
      version: element.version
    })
  }
  return { changes: [...adds, ...updates, ...deletes], fields }
}

export const executePreview = async (api: ExcalidrawImperativeAPI, input: PreviewInput) => {
  assertRequestBudget('preview', input)
  const schema = excalidrawVerbInputSchemas[input.verb]
  const parsed = schema.safeParse(input.input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const path = issue.path.join('.')
    throw new Error(
      `preview: invalid input for verb "${input.verb}": ${path ? `${path}: ` : ''}${issue.message}`
    )
  }

  const before = api.getSceneElements()
  const sceneVersion = sceneVersionOf(before)
  const { proxy, captured } = buildCapture(api)
  // The executor runs its real validation and geometry — a throw here (stale
  // version, lock, relationship guard) propagates unchanged, and nothing was
  // captured, so the scene is provably untouched.
  await dispatch[input.verb](proxy, parsed.data as never)
  const after = captured() ?? before

  const { changes, fields } = buildChanges(before, after)
  const summary = {
    adds: changes.filter((change) => change.op === 'add').length,
    updates: changes.filter((change) => change.op === 'update').length,
    deletes: changes.filter((change) => change.op === 'delete').length,
    total: changes.length
  }

  // Mirror `boundedResult`'s build-a-candidate pattern (no page): summary counts
  // are computed from the full diff and never shrink; trimming only drops
  // trailing `changes` entries.
  return trimToBudget(
    (count) => {
      const trimmed = changes.slice(0, count)
      const candidate = {
        ok: true as const,
        verb: input.verb,
        wouldChange: summary.total > 0,
        sceneVersion,
        summary,
        changes: trimmed,
        truncation: {
          truncated: fields.length > 0 || trimmed.length < changes.length,
          fields: [...new Set(fields)],
          omittedElements: changes.length - trimmed.length,
          serializedBytes: 0,
          budgetBytes: EXCALIDRAW_PAYLOAD_BUDGETS.preview.result
        }
      }
      settleSerializedBytes(candidate)
      return candidate
    },
    changes.length,
    EXCALIDRAW_PAYLOAD_BUDGETS.preview.result
  )
}
