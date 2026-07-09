import { exportToCanvas as exportToCanvasUntyped } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type { ThumbnailInput } from '@tinytinkerer/excalidraw-protocol'
import { elementMap, sceneVersionOf } from './normalization'
import { serializedUtf8Bytes } from './payload'
import { assertRequestBudget, checkSceneVersion } from './query'

// `exportToCanvas`'s own declaration re-exports from a nested `@excalidraw/utils`
// package that isn't a dependency here, so TS can't resolve its type through
// `@excalidraw/excalidraw` (it falls back to `any`). Recreate the verified
// signature locally — checked against the pinned 0.18.1 declarations at
// `dist/types/utils/export.d.ts` (see SKILL.md "Verifying upstream APIs") — so
// the call stays type-safe.
type ExportToCanvas = (opts: {
  elements: readonly ExcalidrawElement[]
  appState?: { exportBackground?: boolean; viewBackgroundColor?: string }
  files: BinaryFiles | null
  maxWidthOrHeight?: number
}) => Promise<HTMLCanvasElement>

export type RenderedScenePng = {
  dataUrl: string
  mimeType: 'image/png'
  width: number
  height: number
  bytes: number
}

// Shared export path for `thumbnail` and `preview`'s visual: renders the given
// elements (an arbitrary array — the live scene, a scoped subset, or a
// captured, never-committed hypothetical scene) to an offscreen PNG via
// `exportToCanvas`, scaled to `maxDimension`. Returns `null` for an empty
// `elements` array (nothing to render) instead of calling into
// `exportToCanvas` with nothing.
export const renderScenePng = async (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  options: { maxDimension: number; background: boolean }
): Promise<RenderedScenePng | null> => {
  if (elements.length === 0) return null
  const state = api.getAppState()
  // Cast (rather than rebind at module scope) so the property access happens
  // here, only when a render is actually requested — see the note above.
  const canvas = await (exportToCanvasUntyped as ExportToCanvas)({
    elements,
    appState: {
      exportBackground: options.background,
      viewBackgroundColor: state.viewBackgroundColor
    },
    files: api.getFiles(),
    maxWidthOrHeight: options.maxDimension
  })
  const dataUrl = canvas.toDataURL('image/png')
  return {
    dataUrl,
    mimeType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    bytes: dataUrl.length
  }
}

// `thumbnail` renders a byte-budgeted PNG snapshot for visual verification. It is
// on-demand only (no staged state): an over-budget export is an actionable error
// instead of a silently trimmed result, since an image cannot be "trimmed" like a
// record list.
export const executeThumbnail = async (api: ExcalidrawImperativeAPI, input: ThumbnailInput) => {
  assertRequestBudget('thumbnail', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  checkSceneVersion(input.expectedSceneVersion, sceneVersion, 'thumbnail')

  const byId = elementMap(elements)
  const missingIds = (input.elementIds ?? []).filter((id) => !byId.has(id))
  const requested = input.elementIds ? new Set(input.elementIds) : null
  const scoped = requested ? elements.filter((element) => requested.has(element.id)) : elements
  if (scoped.length === 0)
    throw new Error('thumbnail: nothing to export (empty scene or no matching elements)')

  // `scoped.length > 0` was just asserted above, so `renderScenePng` cannot
  // return null here.
  const rendered = (await renderScenePng(api, scoped, {
    maxDimension: input.maxDimension,
    background: input.background
  }))!
  const result = {
    ok: true as const,
    dataUrl: rendered.dataUrl,
    mimeType: rendered.mimeType,
    width: rendered.width,
    height: rendered.height,
    bytes: rendered.bytes,
    elementCount: scoped.length,
    missingIds,
    sceneVersion
  }
  const resultBytes = serializedUtf8Bytes(result)
  if (resultBytes > EXCALIDRAW_PAYLOAD_BUDGETS.thumbnail.result)
    throw new Error(
      `thumbnail: result is ${resultBytes} bytes; maximum is ${EXCALIDRAW_PAYLOAD_BUDGETS.thumbnail.result} bytes — lower maxDimension or scope elementIds`
    )
  return result
}
