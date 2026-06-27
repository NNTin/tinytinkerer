import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  createBridgeServer,
  defineBridgeVerb,
  parentServerTransport
} from '@tinytinkerer/app-bridge'
import type { BridgeServer, CreateBridgeServerOptions } from '@tinytinkerer/app-bridge'
import {
  EXCALIDRAW_APP_ID,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_READ_LIMIT,
  excalidrawVerbContracts
} from '@tinytinkerer/excalidraw-protocol'
import type { DrawElement } from '@tinytinkerer/excalidraw-protocol'

const buildSkeleton = (element: DrawElement): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    x: element.x,
    y: element.y,
    ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
    ...(element.backgroundColor ? { backgroundColor: element.backgroundColor } : {})
  }

  if (element.type === 'text') {
    return { ...base, type: 'text', text: element.text ?? '' }
  }

  const linear = element.type === 'arrow' || element.type === 'line'
  return {
    ...base,
    type: element.type,
    width: element.width ?? 120,
    height: element.height ?? (linear ? 0 : 80),
    ...(element.text ? { label: { text: element.text } } : {})
  }
}

export const createExcalidrawHandlers = (
  api: ExcalidrawImperativeAPI
): CreateBridgeServerOptions['handlers'] => ({
  draw: defineBridgeVerb(excalidrawVerbContracts.draw, (input) => {
    const skeletons = input.elements.map(buildSkeleton)
    const converted = convertToExcalidrawElements(
      skeletons as Parameters<typeof convertToExcalidrawElements>[0]
    )
    const existing = input.replace ? [] : api.getSceneElements()

    api.updateScene({
      elements: [...existing, ...converted],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    api.scrollToContent(converted, { fitToContent: true })

    return { ok: true as const, drawn: converted.length, replaced: input.replace === true }
  }),
  read: defineBridgeVerb(excalidrawVerbContracts.read, () => {
    const all = api.getSceneElements()
    const state = api.getAppState()
    const elements = all.slice(0, EXCALIDRAW_READ_LIMIT).map((element) => {
      const maybeText = (element as { text?: unknown }).text
      return {
        id: element.id,
        type: element.type,
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width),
        height: Math.round(element.height),
        ...(typeof maybeText === 'string' && maybeText.length > 0 ? { text: maybeText } : {})
      }
    })

    return {
      ok: true as const,
      count: all.length,
      truncated: all.length > EXCALIDRAW_READ_LIMIT,
      elements,
      appState: {
        scrollX: Math.round(state.scrollX),
        scrollY: Math.round(state.scrollY),
        zoom: state.zoom.value,
        theme: state.theme
      }
    }
  }),
  clear: defineBridgeVerb(excalidrawVerbContracts.clear, () => {
    api.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    return { ok: true as const }
  })
})

export const createExcalidrawBridge = (
  api: ExcalidrawImperativeAPI,
  sessionNonce: string
): BridgeServer =>
  createBridgeServer(parentServerTransport(), {
    appId: EXCALIDRAW_APP_ID,
    protocolVersion: EXCALIDRAW_PROTOCOL_VERSION,
    sessionNonce,
    handlers: createExcalidrawHandlers(api)
  })
