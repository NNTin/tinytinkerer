import { appToolsFromVerbs, createAppBridgeHandle } from '@tinytinkerer/app-harness'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { excalidrawVerbInputSchemas } from '@tinytinkerer/excalidraw-protocol'

export const canvasBridgeHandle = createAppBridgeHandle()

// Shared concurrency note for the structural verbs (stored once, reused by each
// description). Explicit operands are versioned by default.
const versionedExplicit =
  'Pass versioned element refs ({id, expectedVersion}) and expectedSceneVersion from a prior read. Atomic and undoable.'
const versionedOperands = `${versionedExplicit} Omit elements to operate on the current selection instead.`

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
          'are atomic and undoable; relationship-sensitive geometry changes are rejected.',
        schema: excalidrawVerbInputSchemas.edit
      },
      clear: {
        description: 'Remove every element from the visible Excalidraw whiteboard.',
        schema: excalidrawVerbInputSchemas.clear
      },
      group: {
        description:
          'Group or ungroup Excalidraw elements. Grouping encloses two or more in one new group ' +
          'and carries their bound labels; ungrouping removes the outermost group. ' +
          versionedOperands,
        schema: excalidrawVerbInputSchemas.group
      },
      duplicate: {
        description:
          'Duplicate Excalidraw elements, offset by a configurable delta. Bound labels, groups, ' +
          'and intra-selection bindings are copied with fresh ids so the copy is independent; ' +
          'returns the source-to-new id map. ' +
          versionedExplicit,
        schema: excalidrawVerbInputSchemas.duplicate
      },
      delete: {
        description:
          'Delete Excalidraw elements. By default a delete that would cross a relationship ' +
          '(cascade a bound label or frame child, or detach a connector) is rejected; set ' +
          'includeRelated:true to allow the cascade. ' +
          versionedExplicit,
        schema: excalidrawVerbInputSchemas.delete
      },
      align: {
        description:
          'Align two or more Excalidraw elements to a shared edge or center on the x or y axis. ' +
          'Labels and frame children move with their parent. ' +
          versionedOperands,
        schema: excalidrawVerbInputSchemas.align
      },
      distribute: {
        description:
          'Evenly distribute three or more Excalidraw elements along the x or y axis, keeping the ' +
          'outermost two fixed and equalizing the gaps between the rest. ' +
          versionedOperands,
        schema: excalidrawVerbInputSchemas.distribute
      },
      stack: {
        description:
          'Stack Excalidraw elements horizontally or vertically in order with a configurable gap, ' +
          'anchored at the first element, with optional cross-axis alignment. ' +
          versionedOperands,
        schema: excalidrawVerbInputSchemas.stack
      },
      order: {
        description:
          'Reorder Excalidraw layers: bring elements to front/back or step them forward/backward ' +
          'in the z-stack. Bound labels keep their order above their container. ' +
          versionedOperands,
        schema: excalidrawVerbInputSchemas.order
      },
      transform: {
        description:
          'Move or resize existing Excalidraw elements by id and expected version while respecting ' +
          'relationships: labels and frame children follow, connectors move only when both ends do, ' +
          'and edits that would distort a binding are rejected. Pass reflowConnectors:true to let ' +
          'connectors bound to a moved or resized shape follow their endpoints instead. Atomic and ' +
          'undoable.',
        schema: excalidrawVerbInputSchemas.transform
      },
      bind: {
        description:
          'Bind, rebind, or detach an Excalidraw connector endpoint. Attach a start and/or end to a ' +
          'target shape with an optional anchor (focus -1..1 along the facing edge, plus a gap), or ' +
          'detach to free an endpoint. The connector is re-anchored so it stays readable, and target ' +
          'boundElements are kept in sync. ' +
          versionedExplicit,
        schema: excalidrawVerbInputSchemas.bind
      },
      audit: {
        description:
          'Audit Excalidraw connector bindings without changing anything. Reports each endpoint as ' +
          'unbound, ok, stale, detached, or ambiguous and suggests safe repairs (rebind or detach via ' +
          'the bind verb). Pass connectorIds to scope it, or omit to audit every connector. Budgeted, ' +
          'paginated, and detail-aware.',
        schema: excalidrawVerbInputSchemas.audit
      }
    }
  })
