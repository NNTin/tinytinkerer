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
          'coordinates in pixels. For diagrams, prefer declarative connectors with element ids: ' +
          'horizontal links use one shared rowY and vertical trunks use one shared trunkX, computed ' +
          'after node layout so connector endpoints stay aligned. New elements append by default; ' +
          'use replace:true to start fresh.',
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
          'are atomic and undoable; include expectedSceneVersion when moving or resizing elements ' +
          'with labels or frame children so related geometry is updated safely.',
        schema: excalidrawVerbInputSchemas.edit
      },
      group: {
        description:
          'Group existing Excalidraw elements by id and expected version from read. The operation ' +
          'is scene-version checked, atomic, undoable, and includes bound text labels.',
        schema: excalidrawVerbInputSchemas.group
      },
      ungroup: {
        description:
          'Ungroup existing Excalidraw elements by id and expected version. Removes an innermost ' +
          'or specified group id in one atomic undoable scene update.',
        schema: excalidrawVerbInputSchemas.ungroup
      },
      duplicate: {
        description:
          'Duplicate existing Excalidraw elements by id and expected version with a configurable ' +
          'offset. Relationship-owned labels and frame children are duplicated by default.',
        schema: excalidrawVerbInputSchemas.duplicate
      },
      delete: {
        description:
          'Delete existing Excalidraw elements by id and expected version. Relationship crossings ' +
          'are rejected unless includeRelated is true, and the update is undoable.',
        schema: excalidrawVerbInputSchemas.delete
      },
      align: {
        description:
          'Align specified Excalidraw elements by id along x or y using start, center, or end. ' +
          'Single-element align is a safe no-op; related labels move with their containers.',
        schema: excalidrawVerbInputSchemas.align
      },
      distribute: {
        description:
          'Distribute specified Excalidraw elements by id along x or y. One or two elements are ' +
          'safe no-ops; labels and frame children move with their owners.',
        schema: excalidrawVerbInputSchemas.distribute
      },
      stack: {
        description:
          'Stack specified Excalidraw elements horizontally or vertically with configurable ' +
          'spacing. Uses input order by default and keeps the mutation atomic and undoable.',
        schema: excalidrawVerbInputSchemas.stack
      },
      reorder: {
        description:
          'Reorder Excalidraw layers by id: bring forward/backward one step or send to front/back. ' +
          'The scene version and element versions guard stale z-order changes.',
        schema: excalidrawVerbInputSchemas.reorder
      },
      clear: {
        description: 'Remove every element from the visible Excalidraw whiteboard.',
        schema: excalidrawVerbInputSchemas.clear
      }
    }
  })
