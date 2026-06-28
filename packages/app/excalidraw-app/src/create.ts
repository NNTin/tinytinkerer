import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DrawElement, DrawInput } from '@tinytinkerer/excalidraw-protocol'
import { assertRequestBudget } from './query'

const skeleton = (element: DrawElement): Record<string, unknown> => {
  const base = {
    x: element.x,
    y: element.y,
    ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
    ...(element.backgroundColor ? { backgroundColor: element.backgroundColor } : {})
  }
  if (element.type === 'text') return { ...base, type: 'text', text: element.text ?? '' }
  const linear = element.type === 'arrow' || element.type === 'line'
  return {
    ...base,
    type: element.type,
    width: element.width ?? 120,
    height: element.height ?? (linear ? 0 : 80),
    ...(element.text ? { label: { text: element.text } } : {})
  }
}

export const executeDraw = (api: ExcalidrawImperativeAPI, input: DrawInput) => {
  assertRequestBudget('draw', input)
  const converted = convertToExcalidrawElements(
    input.elements.map(skeleton) as Parameters<typeof convertToExcalidrawElements>[0]
  )
  api.updateScene({
    elements: [...(input.replace ? [] : api.getSceneElements()), ...converted],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY
  })
  api.scrollToContent(converted, { fitToContent: true })
  return { ok: true as const, drawn: converted.length, replaced: input.replace === true }
}

export const executeClear = (api: ExcalidrawImperativeAPI, input: Record<string, never>) => {
  assertRequestBudget('clear', input)
  api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
  return { ok: true as const }
}
