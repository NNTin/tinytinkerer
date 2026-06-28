import { appToolsFromVerbs, createAppBridgeHandle } from '@tinytinkerer/app-harness'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { excalidrawVerbInputSchemas } from '@tinytinkerer/excalidraw-protocol'

export const canvasBridgeHandle = createAppBridgeHandle()

export const createCanvasAppTools = (handle: AppBridgeHandle = canvasBridgeHandle) =>
  appToolsFromVerbs({
    handle,
    verbs: {
      draw: {
        description:
          'Draw shapes, text, arrows, or lines on the visible Excalidraw whiteboard. Use canvas ' +
          'coordinates in pixels. New elements append by default; use replace:true to start fresh.',
        schema: excalidrawVerbInputSchemas.draw
      },
      search: {
        description:
          'Find Excalidraw element candidates before inspecting them. Search by text, id, or type ' +
          'across the full scene, the current selection, or the visible viewport.',
        schema: excalidrawVerbInputSchemas.search
      },
      inspect: {
        description:
          'Inspect the Excalidraw scene, viewport, zoom, selection, and structure. Optionally pass ' +
          'candidate element ids from search to get compact grouping and relationship summaries.',
        schema: excalidrawVerbInputSchemas.inspect
      },
      read: {
        description:
          'Read normalized full content for specific Excalidraw element ids after search and ' +
          'inspect. Returns exact geometry, styles, text, bindings, and versions required by edit.',
        schema: excalidrawVerbInputSchemas.read
      },
      edit: {
        description:
          'Safely edit existing Excalidraw elements by id and expected version from read. Batches ' +
          'are atomic and undoable; relationship-sensitive geometry changes are rejected.',
        schema: excalidrawVerbInputSchemas.edit
      },
      clear: {
        description: 'Remove every element from the visible Excalidraw whiteboard.',
        schema: excalidrawVerbInputSchemas.clear
      }
    }
  })
