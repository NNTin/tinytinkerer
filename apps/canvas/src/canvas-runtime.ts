import { appToolsFromVerbs, createAppBridgeHandle } from '@tinytinkerer/app-harness'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { excalidrawVerbContracts } from '@tinytinkerer/excalidraw-protocol'

export const canvasBridgeHandle = createAppBridgeHandle()

export const createCanvasAppTools = (handle: AppBridgeHandle = canvasBridgeHandle) =>
  appToolsFromVerbs({
    handle,
    verbs: {
      draw: {
        description:
          'Draw shapes, text, arrows, or lines on the visible Excalidraw whiteboard. Use canvas ' +
          'coordinates in pixels. New elements append by default; use replace:true to start fresh.',
        schema: excalidrawVerbContracts.draw.inputSchema
      },
      read: {
        description:
          'Read a compact summary of the visible Excalidraw whiteboard before describing it or ' +
          'positioning new elements relative to existing content.',
        schema: excalidrawVerbContracts.read.inputSchema
      },
      clear: {
        description: 'Remove every element from the visible Excalidraw whiteboard.',
        schema: excalidrawVerbContracts.clear.inputSchema
      }
    }
  })
