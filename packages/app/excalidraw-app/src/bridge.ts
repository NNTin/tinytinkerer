import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
  getVisibleSceneBounds,
  newElementWith
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  OrderedExcalidrawElement
} from '@excalidraw/excalidraw/element/types'
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
  excalidrawVerbContracts
} from '@tinytinkerer/excalidraw-protocol'
import type {
  DrawElement,
  EditChanges,
  EditInput,
  ReadElement,
  SearchInput
} from '@tinytinkerer/excalidraw-protocol'

const PREVIEW_TEXT_LIMIT = 160
const POSITIONABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'])
const RESIZABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height', 'angleDegrees'])

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

const toPlainPoint = (point: readonly [number, number]): [number, number] => [point[0], point[1]]

const compactBounds = (element: ExcalidrawElement) => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    width: Math.max(0, Math.round(x2 - x1)),
    height: Math.max(0, Math.round(y2 - y1))
  }
}

const elementMap = (elements: readonly OrderedExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, element]))

const labelFor = (
  element: ExcalidrawElement,
  elementsById: ReadonlyMap<string, ExcalidrawElement>
): { elementId: string; text: string } | undefined => {
  const labelReference = element.boundElements?.find((bound) => bound.type === 'text')
  if (!labelReference) return undefined
  const label = elementsById.get(labelReference.id)
  if (label?.type !== 'text') return undefined
  return { elementId: label.id, text: label.text }
}

const displayNameFor = (
  element: ExcalidrawElement,
  elementsById: ReadonlyMap<string, ExcalidrawElement>
): string | undefined => {
  if (element.type === 'text') return element.text
  const label = labelFor(element, elementsById)
  if (label) return label.text
  if (element.type === 'frame' || element.type === 'magicframe') return element.name ?? undefined
  return undefined
}

const previewNameFor = (
  element: ExcalidrawElement,
  elementsById: ReadonlyMap<string, ExcalidrawElement>
): string | undefined => {
  const name = displayNameFor(element, elementsById)
  if (!name) return undefined
  return name.length > PREVIEW_TEXT_LIMIT ? `${name.slice(0, PREVIEW_TEXT_LIMIT - 1)}…` : name
}

const selectionFromState = (state: ReturnType<ExcalidrawImperativeAPI['getAppState']>) => ({
  elementIds: Object.keys(state.selectedElementIds),
  groupIds: Object.keys(state.selectedGroupIds),
  editingGroupId: state.editingGroupId
})

const viewportFromState = (state: ReturnType<ExcalidrawImperativeAPI['getAppState']>) => {
  const [x1, y1, x2, y2] = getVisibleSceneBounds(state)
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    width: Math.max(0, Math.round(x2 - x1)),
    height: Math.max(0, Math.round(y2 - y1)),
    scrollX: Math.round(state.scrollX),
    scrollY: Math.round(state.scrollY),
    zoom: state.zoom.value
  }
}

const visibleElements = (
  elements: readonly OrderedExcalidrawElement[],
  state: ReturnType<ExcalidrawImperativeAPI['getAppState']>
) => {
  const [viewportX1, viewportY1, viewportX2, viewportY2] = getVisibleSceneBounds(state)
  return elements.filter((element) => {
    const [elementX1, elementY1, elementX2, elementY2] = getCommonBounds([element])
    return (
      elementX2 >= viewportX1 &&
      elementY2 >= viewportY1 &&
      elementX1 <= viewportX2 &&
      elementY1 <= viewportY2
    )
  })
}

const searchElement = (
  element: OrderedExcalidrawElement,
  zIndex: number,
  elementsById: ReadonlyMap<string, ExcalidrawElement>,
  selectedIds: ReadonlySet<string>
) => {
  const name = previewNameFor(element, elementsById)
  return {
    id: element.id,
    type: element.type,
    ...(name ? { name } : {}),
    bounds: compactBounds(element),
    zIndex,
    selected: selectedIds.has(element.id)
  }
}

const inspectElement = (
  element: OrderedExcalidrawElement,
  zIndex: number,
  elementsById: ReadonlyMap<string, ExcalidrawElement>,
  selectedIds: ReadonlySet<string>
) => ({
  ...searchElement(element, zIndex, elementsById, selectedIds),
  locked: element.locked,
  groupIds: [...element.groupIds],
  frameId: element.frameId,
  boundElementIds: element.boundElements?.map((bound) => bound.id) ?? []
})

const normalizeBinding = (binding: ExcalidrawLinearElement['startBinding']) => {
  if (!binding) return null
  const fixedPoint =
    'fixedPoint' in binding && Array.isArray(binding.fixedPoint)
      ? (binding.fixedPoint as [number, number])
      : null
  return {
    elementId: binding.elementId,
    focus: binding.focus,
    gap: binding.gap,
    ...(fixedPoint ? { fixedPoint: toPlainPoint(fixedPoint) } : {})
  }
}

const readElement = (
  element: OrderedExcalidrawElement,
  zIndex: number,
  elementsById: ReadonlyMap<string, ExcalidrawElement>
): ReadElement => {
  const label = labelFor(element, elementsById)
  const base: ReadElement = {
    id: element.id,
    type: element.type,
    version: element.version,
    zIndex,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    angleDegrees: (element.angle * 180) / Math.PI,
    style: {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      fillStyle: element.fillStyle,
      strokeWidth: element.strokeWidth,
      strokeStyle: element.strokeStyle,
      roughness: element.roughness,
      opacity: element.opacity
    },
    locked: element.locked,
    groupIds: [...element.groupIds],
    frameId: element.frameId,
    link: element.link,
    boundElements:
      element.boundElements?.map((bound) => ({
        id: bound.id,
        type: bound.type
      })) ?? [],
    ...(label ? { label } : {})
  }

  if (element.type === 'text') {
    base.text = {
      text: element.text,
      originalText: element.originalText,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
      textAlign: element.textAlign,
      verticalAlign: element.verticalAlign,
      containerId: element.containerId,
      autoResize: element.autoResize,
      lineHeight: element.lineHeight
    }
  } else if (element.type === 'line' || element.type === 'arrow') {
    base.linear = {
      points: element.points.map(toPlainPoint),
      startBinding: normalizeBinding(element.startBinding),
      endBinding: normalizeBinding(element.endBinding),
      startArrowhead: element.startArrowhead,
      endArrowhead: element.endArrowhead,
      ...('elbowed' in element && typeof element.elbowed === 'boolean'
        ? { elbowed: element.elbowed }
        : {})
    }
  } else if (element.type === 'freedraw') {
    base.freeDraw = {
      points: element.points.map(toPlainPoint),
      pressures: [...element.pressures],
      simulatePressure: element.simulatePressure
    }
  } else if (element.type === 'image') {
    base.image = {
      fileId: element.fileId,
      status: element.status,
      scale: toPlainPoint(element.scale),
      crop: element.crop
    }
  } else if (element.type === 'frame' || element.type === 'magicframe') {
    base.frameName = element.name
  }

  return base
}

const readRequestedElements = (
  elements: readonly OrderedExcalidrawElement[],
  requestedIds: readonly string[]
) => {
  const requested = new Set(requestedIds)
  const byId = elementMap(elements)
  return {
    elements: elements
      .map((element, zIndex) => ({ element, zIndex }))
      .filter(({ element }) => requested.has(element.id))
      .map(({ element, zIndex }) => readElement(element, zIndex, byId)),
    missingIds: requestedIds.filter((id) => !byId.has(id))
  }
}

const hasChange = (changes: EditChanges, key: keyof EditChanges): boolean =>
  Object.prototype.hasOwnProperty.call(changes, key)

const hasRelationship = (
  target: ExcalidrawElement,
  elements: readonly OrderedExcalidrawElement[]
): boolean => {
  if (
    target.groupIds.length > 0 ||
    target.frameId !== null ||
    (target.boundElements?.length ?? 0) > 0
  ) {
    return true
  }
  if (target.type === 'text' && target.containerId !== null) return true
  if (
    (target.type === 'line' || target.type === 'arrow') &&
    (target.startBinding !== null || target.endBinding !== null)
  ) {
    return true
  }

  return elements.some((element) => {
    if (element.id === target.id) return false
    if (element.frameId === target.id) return true
    if (element.type === 'text' && element.containerId === target.id) return true
    return (
      (element.type === 'line' || element.type === 'arrow') &&
      (element.startBinding?.elementId === target.id || element.endBinding?.elementId === target.id)
    )
  })
}

const validateEdit = (
  element: OrderedExcalidrawElement,
  changes: EditChanges,
  elements: readonly OrderedExcalidrawElement[]
): void => {
  const nonLockChanges = Object.keys(changes).some((key) => key !== 'locked')
  if (element.locked && nonLockChanges && changes.locked !== false) {
    throw new Error(
      `edit: element "${element.id}" is locked; include locked:false to explicitly unlock it`
    )
  }

  const geometryChange = Object.keys(changes).some((key) => GEOMETRY_KEYS.has(key))
  if (geometryChange) {
    if (!POSITIONABLE_TYPES.has(element.type)) {
      throw new Error(`edit: geometry changes are not supported for element type "${element.type}"`)
    }
    if (hasRelationship(element, elements)) {
      throw new Error(
        `edit: element "${element.id}" has group, frame, label, or connector relationships; geometry changes require relationship-aware editing`
      )
    }
  }

  if (
    (hasChange(changes, 'width') || hasChange(changes, 'height')) &&
    !RESIZABLE_TYPES.has(element.type)
  ) {
    throw new Error(
      `edit: width and height changes are only supported for standalone rectangles, ellipses, and diamonds`
    )
  }

  if (hasChange(changes, 'text')) {
    if (element.type !== 'text') {
      throw new Error(`edit: text changes require a text element id`)
    }
    if (element.containerId !== null || !element.autoResize || hasRelationship(element, elements)) {
      throw new Error(
        `edit: text changes are only supported for standalone auto-resizing text elements`
      )
    }
  }
}

const measureStandaloneText = (element: ExcalidrawTextElement, text: string) => {
  const [measured] = convertToExcalidrawElements([
    {
      type: 'text',
      x: element.x,
      y: element.y,
      text,
      fontFamily: element.fontFamily,
      fontSize: element.fontSize,
      lineHeight: element.lineHeight
    }
  ])
  if (measured?.type !== 'text') throw new Error('edit: failed to measure text')
  return {
    text: measured.text,
    originalText: measured.originalText,
    width: measured.width,
    height: measured.height
  }
}

const applyEditChanges = (
  element: OrderedExcalidrawElement,
  changes: EditChanges
): OrderedExcalidrawElement => {
  const updates: Record<string, unknown> = {}

  for (const key of [
    'x',
    'y',
    'width',
    'height',
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'roughness',
    'opacity',
    'locked'
  ] as const) {
    if (hasChange(changes, key)) updates[key] = changes[key]
  }

  if (hasChange(changes, 'angleDegrees')) {
    updates.angle = ((changes.angleDegrees ?? 0) * Math.PI) / 180
  }
  if (hasChange(changes, 'text') && element.type === 'text') {
    Object.assign(updates, measureStandaloneText(element, changes.text ?? ''))
  }

  return newElementWith(
    element,
    updates as Parameters<typeof newElementWith<OrderedExcalidrawElement>>[1]
  )
}

const executeSearch = (
  api: ExcalidrawImperativeAPI,
  input: SearchInput
): {
  ok: true
  sceneCount: number
  matched: number
  truncated: boolean
  elements: ReturnType<typeof searchElement>[]
} => {
  const elements = api.getSceneElements()
  const state = api.getAppState()
  const byId = elementMap(elements)
  const selectedIds = new Set(Object.keys(state.selectedElementIds))
  const types = input.types ? new Set(input.types) : null
  const query = input.query?.toLocaleLowerCase()
  const viewportIds =
    input.scope === 'viewport'
      ? new Set(visibleElements(elements, state).map((element) => element.id))
      : null

  const matches = elements
    .map((element, zIndex) => ({ element, zIndex }))
    .filter(({ element }) => {
      if (input.scope === 'selection' && !selectedIds.has(element.id)) return false
      if (viewportIds && !viewportIds.has(element.id)) return false
      if (types && !types.has(element.type)) return false
      if (!query) return true
      const name = displayNameFor(element, byId)
      return [element.id, element.type, name]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLocaleLowerCase().includes(query))
    })

  return {
    ok: true,
    sceneCount: elements.length,
    matched: matches.length,
    truncated: matches.length > input.limit,
    elements: matches
      .slice(0, input.limit)
      .map(({ element, zIndex }) => searchElement(element, zIndex, byId, selectedIds))
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
  search: defineBridgeVerb(excalidrawVerbContracts.search, (input) => executeSearch(api, input)),
  inspect: defineBridgeVerb(excalidrawVerbContracts.inspect, (input) => {
    const elements = api.getSceneElements()
    const state = api.getAppState()
    const byId = elementMap(elements)
    const selectedIds = new Set(Object.keys(state.selectedElementIds))
    const requestedIds = input.elementIds ? new Set(input.elementIds) : null
    const visible = visibleElements(elements, state)
    const [x1, y1, x2, y2] = elements.length > 0 ? getCommonBounds(elements) : [0, 0, 0, 0]
    const typeCounts = elements.reduce<Record<string, number>>((counts, element) => {
      counts[element.type] = (counts[element.type] ?? 0) + 1
      return counts
    }, {})

    return {
      ok: true as const,
      scene: {
        elementCount: elements.length,
        visibleElementCount: visible.length,
        typeCounts,
        bounds:
          elements.length > 0
            ? {
                x: Math.round(x1),
                y: Math.round(y1),
                width: Math.max(0, Math.round(x2 - x1)),
                height: Math.max(0, Math.round(y2 - y1))
              }
            : null,
        viewport: viewportFromState(state),
        selection: selectionFromState(state),
        theme: state.theme,
        backgroundColor: state.viewBackgroundColor,
        grid: {
          enabled: state.gridModeEnabled,
          size: state.gridSize,
          step: state.gridStep
        }
      },
      elements: requestedIds
        ? elements
            .map((element, zIndex) => ({ element, zIndex }))
            .filter(({ element }) => requestedIds.has(element.id))
            .map(({ element, zIndex }) => inspectElement(element, zIndex, byId, selectedIds))
        : [],
      missingIds: input.elementIds?.filter((id) => !byId.has(id)) ?? []
    }
  }),
  read: defineBridgeVerb(excalidrawVerbContracts.read, (input) => ({
    ok: true as const,
    ...readRequestedElements(api.getSceneElements(), input.elementIds)
  })),
  edit: defineBridgeVerb(excalidrawVerbContracts.edit, (input: EditInput) => {
    const elements = api.getSceneElements()
    const byId = elementMap(elements)

    for (const edit of input.edits) {
      const element = byId.get(edit.id)
      if (!element) throw new Error(`edit: element "${edit.id}" does not exist`)
      if (element.version !== edit.expectedVersion) {
        throw new Error(
          `edit: element "${edit.id}" is stale (expected version ${edit.expectedVersion}, current version ${element.version}); read it again before retrying`
        )
      }
      validateEdit(element, edit.changes, elements)
    }

    const editsById = new Map(input.edits.map((edit) => [edit.id, edit]))
    let updated = 0
    const nextElements = elements.map((element) => {
      const edit = editsById.get(element.id)
      if (!edit) return element
      const next = applyEditChanges(element, edit.changes)
      if (next !== element) updated += 1
      return next
    })

    if (updated > 0) {
      api.updateScene({
        elements: nextElements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
      })
    }

    return {
      ok: true as const,
      updated,
      elements: readRequestedElements(
        nextElements,
        input.edits.map((edit) => edit.id)
      ).elements
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
