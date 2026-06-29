import { getCommonBounds, getVisibleSceneBounds } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  EXCALIDRAW_FIELD_LIMITS,
  EXCALIDRAW_PAYLOAD_BUDGETS
} from '@tinytinkerer/excalidraw-protocol'
import type { InspectInput, ReadInput, SearchInput } from '@tinytinkerer/excalidraw-protocol'
import { serializedUtf8Bytes, settleSerializedBytes, truncateUtf8 } from './payload'
import {
  compactBounds,
  displayNameFor,
  elementMap,
  normalizeElement,
  sceneVersionOf
} from './normalization'

export const assertRequestBudget = (
  verb: keyof typeof EXCALIDRAW_PAYLOAD_BUDGETS,
  input: unknown
): void => {
  const size = serializedUtf8Bytes(input)
  const budget = EXCALIDRAW_PAYLOAD_BUDGETS[verb].request
  if (size > budget)
    throw new Error(`${verb}: request payload is ${size} bytes; maximum is ${budget} bytes`)
}

const checkSceneVersion = (expected: number | undefined, actual: number, verb: string): void => {
  if (expected !== undefined && expected !== actual) {
    throw new Error(
      `${verb}: scene changed (expected scene version ${expected}, current version ${actual}); restart pagination from offset 0`
    )
  }
}

const makePage = (offset: number, limit: number, returned: number, total: number) => ({
  offset,
  limit,
  returned,
  total,
  nextOffset: offset + returned < total ? offset + returned : null
})

const boundedResult = <T extends { elements: unknown[]; page: ReturnType<typeof makePage> }>(
  result: T,
  budgetBytes: number,
  fields: string[]
): T & {
  truncation: {
    truncated: boolean
    fields: string[]
    omittedElements: number
    serializedBytes: number
    budgetBytes: number
  }
} => {
  const originalCount = result.elements.length
  let elements = result.elements
  let candidate: T & {
    truncation: {
      truncated: boolean
      fields: string[]
      omittedElements: number
      serializedBytes: number
      budgetBytes: number
    }
  }
  for (;;) {
    const omittedElements = originalCount - elements.length
    candidate = {
      ...result,
      elements,
      page: {
        ...result.page,
        returned: elements.length,
        nextOffset:
          result.page.offset + elements.length < result.page.total
            ? result.page.offset + elements.length
            : null
      },
      truncation: {
        truncated:
          fields.length > 0 ||
          omittedElements > 0 ||
          result.page.offset + elements.length < result.page.total,
        fields: [...new Set(fields)],
        omittedElements,
        serializedBytes: 0,
        budgetBytes
      }
    }
    settleSerializedBytes(candidate)
    if (candidate.truncation.serializedBytes <= budgetBytes) return candidate
    if (elements.length === 0) {
      throw new Error(`result metadata exceeds the ${budgetBytes} byte payload budget`)
    }
    elements = elements.slice(0, -1)
  }
}

const visibleElements = (
  elements: readonly OrderedExcalidrawElement[],
  state: ReturnType<ExcalidrawImperativeAPI['getAppState']>
) => {
  const [x1, y1, x2, y2] = getVisibleSceneBounds(state)
  return elements.filter((element) => {
    const [a, b, c, d] = getCommonBounds([element])
    return c >= x1 && d >= y1 && a <= x2 && b <= y2
  })
}

const preview = (value: string | undefined): { name?: string; truncated: boolean } => {
  if (!value) return { truncated: false }
  const name = truncateUtf8(value, EXCALIDRAW_FIELD_LIMITS.name)
  return { name, truncated: name !== value }
}

export const executeSearch = (api: ExcalidrawImperativeAPI, input: SearchInput) => {
  assertRequestBudget('search', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  checkSceneVersion(input.expectedSceneVersion, sceneVersion, 'search')
  const state = api.getAppState()
  const byId = elementMap(elements)
  const selectedIds = new Set(Object.keys(state.selectedElementIds))
  const types = input.types ? new Set(input.types) : null
  const query = input.query?.toLocaleLowerCase()
  const viewportIds =
    input.scope === 'viewport'
      ? new Set(visibleElements(elements, state).map(({ id }) => id))
      : null
  const matches = elements
    .map((element, zIndex) => ({ element, zIndex }))
    .filter(({ element }) => {
      if (input.scope === 'selection' && !selectedIds.has(element.id)) return false
      if (viewportIds && !viewportIds.has(element.id)) return false
      if (types && !types.has(element.type)) return false
      if (!query) return true
      return [element.id, element.type, displayNameFor(element, byId)]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLocaleLowerCase().includes(query))
    })
  const fields: string[] = []
  const pageElements = matches
    .slice(input.offset, input.offset + input.limit)
    .map(({ element, zIndex }) => {
      const name =
        input.detail === 'summary'
          ? { truncated: false as const }
          : preview(displayNameFor(element, byId))
      if (name.truncated) fields.push(`${element.id}.name`)
      return {
        id: element.id,
        type: element.type,
        ...(name.name ? { name: name.name } : {}),
        bounds: compactBounds(element),
        zIndex,
        selected: selectedIds.has(element.id)
      }
    })
  return boundedResult(
    {
      ok: true as const,
      detail: input.detail,
      sceneCount: elements.length,
      matched: matches.length,
      sceneVersion,
      page: makePage(input.offset, input.limit, pageElements.length, matches.length),
      elements: pageElements
    },
    EXCALIDRAW_PAYLOAD_BUDGETS.search.result,
    fields
  )
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

export const executeInspect = (api: ExcalidrawImperativeAPI, input: InspectInput) => {
  assertRequestBudget('inspect', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  checkSceneVersion(input.expectedSceneVersion, sceneVersion, 'inspect')
  const state = api.getAppState()
  const byId = elementMap(elements)
  const selectedIds = new Set(Object.keys(state.selectedElementIds))
  const requested = input.elementIds ?? []
  const found = requested
    .map((id) => elements.findIndex((element) => element.id === id))
    .filter((index) => index >= 0)
  const fields: string[] = []
  const pageIndexes = found.slice(input.offset, input.offset + input.limit)
  const output = pageIndexes.map((zIndex) => {
    const element = elements[zIndex]!
    const name = preview(displayNameFor(element, byId))
    if (name.truncated) fields.push(`${element.id}.name`)
    const groupLimit =
      input.detail === 'full'
        ? EXCALIDRAW_FIELD_LIMITS.groups
        : Math.min(16, EXCALIDRAW_FIELD_LIMITS.groups)
    const relationshipLimit =
      input.detail === 'full'
        ? EXCALIDRAW_FIELD_LIMITS.relationships
        : Math.min(64, EXCALIDRAW_FIELD_LIMITS.relationships)
    const groupIds = element.groupIds.slice(0, groupLimit)
    const boundElementIds = (element.boundElements ?? [])
      .slice(0, relationshipLimit)
      .map(({ id }) => id)
    if (groupIds.length < element.groupIds.length) fields.push(`${element.id}.groupIds`)
    if (boundElementIds.length < (element.boundElements?.length ?? 0))
      fields.push(`${element.id}.boundElementIds`)
    const compact = {
      id: element.id,
      type: element.type,
      ...(name.name ? { name: name.name } : {}),
      bounds: compactBounds(element),
      zIndex,
      selected: selectedIds.has(element.id),
      locked: element.locked
    }
    return input.detail === 'summary'
      ? compact
      : { ...compact, groupIds, frameId: element.frameId, boundElementIds }
  })
  const [x1, y1, x2, y2] = elements.length ? getCommonBounds(elements) : [0, 0, 0, 0]
  const typeCounts = elements.reduce<Record<string, number>>(
    (counts, element) => ({ ...counts, [element.type]: (counts[element.type] ?? 0) + 1 }),
    {}
  )
  const base = {
    ok: true as const,
    detail: input.detail,
    sceneVersion,
    scene: {
      elementCount: elements.length,
      visibleElementCount: visibleElements(elements, state).length,
      typeCounts,
      bounds: elements.length
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
      grid: { enabled: state.gridModeEnabled, size: state.gridSize, step: state.gridStep }
    },
    missingIds: requested.filter((id) => !byId.has(id)),
    page: makePage(input.offset, input.limit, output.length, found.length),
    elements: output
  }
  return boundedResult(base, EXCALIDRAW_PAYLOAD_BUDGETS.inspect.result, fields)
}

export const executeRead = (api: ExcalidrawImperativeAPI, input: ReadInput) => {
  assertRequestBudget('read', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  checkSceneVersion(input.expectedSceneVersion, sceneVersion, 'read')
  const byId = elementMap(elements)
  const requested = input.elementIds
    .map((id) => ({ id, index: elements.findIndex((element) => element.id === id) }))
    .filter(({ index }) => index >= 0)
  const fields: string[] = []
  const output = requested.slice(input.offset, input.offset + input.limit).map(({ index }) => {
    const normalized = normalizeElement(elements[index]!, index, elements, input.detail)
    fields.push(...normalized.truncatedFields.map((field) => `${normalized.element.id}.${field}`))
    return normalized.element
  })
  return boundedResult(
    {
      ok: true as const,
      detail: input.detail,
      sceneVersion,
      missingIds: input.elementIds.filter((id) => !byId.has(id)),
      page: makePage(input.offset, input.limit, output.length, requested.length),
      elements: output
    },
    EXCALIDRAW_PAYLOAD_BUDGETS.read.result,
    fields
  )
}
