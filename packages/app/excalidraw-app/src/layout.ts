import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type {
  ArrangeInput,
  LayoutFinding,
  PlaceInput,
  SnapInput,
  SurveyInput
} from '@tinytinkerer/excalidraw-protocol'
import {
  boxOf,
  boxesIntersect,
  combinedBox,
  connectorEndpoints,
  isLinear,
  reflowBoundConnectors,
  updateWith,
  type Box
} from './geometry'
import { changedByIdentity, commitWrite } from './mutation'
import { elementMap, sceneVersionOf } from './normalization'
import { settleSerializedBytes, trimToBudget } from './payload'
import { assertRequestBudget, makePage } from './query'
import { applyDeltas, resolveOperands } from './structure'
import type { Delta } from './structure'

// Layout helper verbs. `snap`/`place`/`arrange` reposition existing elements,
// carrying labels/frame children (via `applyDeltas`) and re-anchoring bound
// connectors (via `reflowBoundConnectors`) so relationships stay consistent, then
// commit through the shared `commitWrite`. `survey` is a read that reports layout
// health (overlaps, label overflow, unreadable connectors). The box/overlap and
// connector geometry all live in `geometry.ts`.

// Connectors shorter than this read as unreadable; survey flags them.
const MIN_READABLE_CONNECTOR_LENGTH = 8
const RESIZABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
// Element kinds whose bounding boxes are meaningful for overlap detection.
const NODE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'image', 'text'])

const snapValueToGrid = (value: number, size: number): number => Math.round(value / size) * size

const gridSizeFor = (api: ExcalidrawImperativeAPI, explicit: number | undefined): number | null => {
  if (explicit !== undefined) return explicit
  const size = (api.getAppState() as { gridSize?: unknown }).gridSize
  return typeof size === 'number' && size > 0 ? size : null
}

export const executeSnap = (api: ExcalidrawImperativeAPI, input: SnapInput) => {
  assertRequestBudget('snap', input)
  const { elements, targets } = resolveOperands(
    api,
    'snap',
    input.elements,
    input.expectedSceneVersion
  )
  const gridSize = gridSizeFor(api, input.gridSize)
  const baseDeltas = new Map<string, Delta>()
  const resizes = new Map<string, { width: number; height: number }>()
  if (gridSize) {
    for (const element of targets) {
      const box = boxOf(element)
      const dx = snapValueToGrid(box.x1, gridSize) - box.x1
      const dy = snapValueToGrid(box.y1, gridSize) - box.y1
      if (dx !== 0 || dy !== 0) baseDeltas.set(element.id, { dx, dy })
      if (input.snapSize && RESIZABLE_TYPES.has(element.type)) {
        const width = Math.max(gridSize, snapValueToGrid(box.width, gridSize))
        const height = Math.max(gridSize, snapValueToGrid(box.height, gridSize))
        if (width !== box.width || height !== box.height) resizes.set(element.id, { width, height })
      }
    }
  }
  const moved = applyDeltas(elements, baseDeltas)
  let nextElements: readonly OrderedExcalidrawElement[] = moved.nextElements
  const changedTargetIds = new Set<string>(moved.movedIds)
  if (resizes.size > 0) {
    nextElements = nextElements.map((element) => {
      const resize = resizes.get(element.id)
      if (!resize) return element
      changedTargetIds.add(element.id)
      return updateWith(element, resize)
    })
  }
  if (changedTargetIds.size > 0)
    nextElements = reflowBoundConnectors([...nextElements], changedTargetIds)
  return commitWrite(
    api,
    nextElements,
    changedByIdentity(elements, nextElements),
    EXCALIDRAW_PAYLOAD_BUDGETS.snap.result
  )
}

// The cluster's target top-left for a relation, then the delta to get there.
const placementDelta = (
  relation: PlaceInput['relation'],
  align: PlaceInput['align'],
  gap: number,
  anchor: Box,
  cluster: Box
): Delta => {
  const crossX = (): number =>
    align === 'start'
      ? anchor.x1
      : align === 'end'
        ? anchor.x2 - cluster.width
        : anchor.cx - cluster.width / 2
  const crossY = (): number =>
    align === 'start'
      ? anchor.y1
      : align === 'end'
        ? anchor.y2 - cluster.height
        : anchor.cy - cluster.height / 2
  let left: number
  let top: number
  if (relation === 'below') {
    top = anchor.y2 + gap
    left = crossX()
  } else if (relation === 'above') {
    top = anchor.y1 - gap - cluster.height
    left = crossX()
  } else if (relation === 'right-of') {
    left = anchor.x2 + gap
    top = crossY()
  } else if (relation === 'left-of') {
    left = anchor.x1 - gap - cluster.width
    top = crossY()
  } else {
    left = anchor.cx - cluster.width / 2
    top = anchor.cy - cluster.height / 2
  }
  return { dx: left - cluster.x1, dy: top - cluster.y1 }
}

export const executePlace = (api: ExcalidrawImperativeAPI, input: PlaceInput) => {
  assertRequestBudget('place', input)
  const { elements, targets } = resolveOperands(
    api,
    'place',
    input.elements,
    input.expectedSceneVersion
  )
  const anchorRef = input.anchor
  let anchorBox: Box
  if ('elementId' in anchorRef) {
    const anchor = elementMap(elements).get(anchorRef.elementId)
    if (!anchor) throw new Error(`place: anchor element "${anchorRef.elementId}" does not exist`)
    anchorBox = boxOf(anchor)
  } else {
    const members = elements.filter((element) => element.groupIds.includes(anchorRef.groupId))
    if (members.length === 0)
      throw new Error(`place: anchor group "${anchorRef.groupId}" has no members`)
    anchorBox = combinedBox(members)
  }
  const delta = placementDelta(
    input.relation,
    input.align,
    input.gap,
    anchorBox,
    combinedBox(targets)
  )
  const baseDeltas = new Map<string, Delta>()
  if (delta.dx !== 0 || delta.dy !== 0)
    for (const element of targets) baseDeltas.set(element.id, delta)
  let nextElements: readonly OrderedExcalidrawElement[] = applyDeltas(
    elements,
    baseDeltas
  ).nextElements
  nextElements = reflowBoundConnectors([...nextElements], new Set(targets.map((t) => t.id)))
  return commitWrite(
    api,
    nextElements,
    changedByIdentity(elements, nextElements),
    EXCALIDRAW_PAYLOAD_BUDGETS.place.result
  )
}

const arrangeDeltas = (
  layout: ArrangeInput['layout'],
  targets: readonly OrderedExcalidrawElement[]
): Map<string, Delta> => {
  const boxes = targets.map(boxOf)
  const deltas = new Map<string, Delta>()
  const n = targets.length
  if (layout.pattern === 'grid') {
    const columns =
      layout.columns ?? (layout.rows ? Math.ceil(n / layout.rows) : Math.ceil(Math.sqrt(n)))
    const cellWidth = Math.max(...boxes.map((box) => box.width))
    const cellHeight = Math.max(...boxes.map((box) => box.height))
    const originX = Math.min(...boxes.map((box) => box.x1))
    const originY = Math.min(...boxes.map((box) => box.y1))
    targets.forEach((element, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const box = boxes[index]!
      const dx = originX + column * (cellWidth + layout.gapX) - box.x1
      const dy = originY + row * (cellHeight + layout.gapY) - box.y1
      if (dx !== 0 || dy !== 0) deltas.set(element.id, { dx, dy })
    })
    return deltas
  }
  const cluster = combinedBox(targets)
  const center = layout.center ?? { x: cluster.cx, y: cluster.cy }
  const maxExtent = Math.max(...boxes.map((box) => Math.hypot(box.width, box.height)))
  const radius = layout.radius ?? Math.max(maxExtent, (n * maxExtent) / (2 * Math.PI))
  targets.forEach((element, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n
    const box = boxes[index]!
    const dx = center.x + radius * Math.cos(angle) - box.cx
    const dy = center.y + radius * Math.sin(angle) - box.cy
    if (dx !== 0 || dy !== 0) deltas.set(element.id, { dx, dy })
  })
  return deltas
}

export const executeArrange = (api: ExcalidrawImperativeAPI, input: ArrangeInput) => {
  assertRequestBudget('arrange', input)
  const { elements, targets } = resolveOperands(
    api,
    'arrange',
    input.elements,
    input.expectedSceneVersion
  )
  const baseDeltas = arrangeDeltas(input.layout, targets)
  let nextElements: readonly OrderedExcalidrawElement[] = applyDeltas(
    elements,
    baseDeltas
  ).nextElements
  nextElements = reflowBoundConnectors([...nextElements], new Set(targets.map((t) => t.id)))
  return commitWrite(
    api,
    nextElements,
    changedByIdentity(elements, nextElements),
    EXCALIDRAW_PAYLOAD_BUDGETS.arrange.result
  )
}

// A pair's overlap is intended (not a finding) when one is the other's bound
// text label or frame child.
const intendedRelation = (a: OrderedExcalidrawElement, b: OrderedExcalidrawElement): boolean => {
  if (a.type === 'text' && a.containerId === b.id) return true
  if (b.type === 'text' && b.containerId === a.id) return true
  if (a.frameId === b.id || b.frameId === a.id) return true
  return false
}

const overlapFindings = (
  scope: readonly OrderedExcalidrawElement[],
  scopeIds: ReadonlySet<string>
): LayoutFinding[] => {
  const nodes = scope.filter(
    (element) => NODE_TYPES.has(element.type) && !(element.type === 'text' && element.containerId)
  )
  const findings: LayoutFinding[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!
      const b = nodes[j]!
      // Only report a pair once: require at least the first to be in scope when a
      // subset was requested (the second may be any scene node it collides with).
      if (!scopeIds.has(a.id) && !scopeIds.has(b.id)) continue
      if (intendedRelation(a, b)) continue
      if (boxesIntersect(boxOf(a), boxOf(b)))
        findings.push({
          kind: 'overlap',
          elementIds: [a.id, b.id],
          message: `elements "${a.id}" and "${b.id}" overlap`,
          suggestion: 'separate them or snap them to a grid'
        })
    }
  }
  return findings
}

const labelFindings = (
  scope: readonly OrderedExcalidrawElement[],
  byId: ReadonlyMap<string, OrderedExcalidrawElement>
): LayoutFinding[] => {
  const findings: LayoutFinding[] = []
  for (const container of scope) {
    const labelRef = container.boundElements?.find((bound) => bound.type === 'text')
    if (!labelRef) continue
    const label = byId.get(labelRef.id)
    if (!label || label.type !== 'text') continue
    const containerBox = boxOf(container)
    const labelBox = boxOf(label)
    if (
      labelBox.x1 < containerBox.x1 ||
      labelBox.x2 > containerBox.x2 ||
      labelBox.y1 < containerBox.y1 ||
      labelBox.y2 > containerBox.y2
    )
      findings.push({
        kind: 'label',
        elementIds: [container.id, label.id],
        message: `label "${label.id}" overflows its container "${container.id}"`,
        suggestion: 'enlarge the container or shorten the label text'
      })
  }
  return findings
}

const arrowFindings = (scope: readonly OrderedExcalidrawElement[]): LayoutFinding[] => {
  const findings: LayoutFinding[] = []
  for (const connector of scope) {
    if (!isLinear(connector)) continue
    const { start, end } = connectorEndpoints(connector)
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_READABLE_CONNECTOR_LENGTH)
      findings.push({
        kind: 'arrow',
        elementIds: [connector.id],
        message: `connector "${connector.id}" is too short to read (near-zero length)`,
        suggestion: 'reposition or rebind its endpoints so it spans a visible distance'
      })
  }
  return findings
}

export const executeSurvey = (api: ExcalidrawImperativeAPI, input: SurveyInput) => {
  assertRequestBudget('survey', input)
  const elements = api.getSceneElements()
  const sceneVersion = sceneVersionOf(elements)
  if (input.expectedSceneVersion !== undefined && input.expectedSceneVersion !== sceneVersion)
    throw new Error(
      `survey: scene changed (expected scene version ${input.expectedSceneVersion}, current version ${sceneVersion}); restart pagination from offset 0`
    )
  const byId = elementMap(elements)
  const requested = input.elementIds
  const missingIds = requested ? requested.filter((id) => !byId.has(id)) : []
  const scopeIds = new Set(requested ?? elements.map((element) => element.id))
  const scope = requested ? elements.filter((element) => scopeIds.has(element.id)) : elements
  const checks = new Set(input.checks ?? ['overlap', 'label', 'arrow'])

  const findings: LayoutFinding[] = []
  if (checks.has('overlap')) findings.push(...overlapFindings(scope, scopeIds))
  if (checks.has('label')) findings.push(...labelFindings(scope, byId))
  if (checks.has('arrow')) findings.push(...arrowFindings(scope))
  const visible =
    input.detail === 'summary'
      ? findings.map((finding) => ({ ...finding, suggestion: null }))
      : findings
  const overlaps = findings.filter((finding) => finding.kind === 'overlap').length
  const labelIssues = findings.filter((finding) => finding.kind === 'label').length
  const arrowIssues = findings.filter((finding) => finding.kind === 'arrow').length

  const budget = EXCALIDRAW_PAYLOAD_BUDGETS.survey.result
  const sliceLength = visible.slice(input.offset, input.offset + input.limit).length
  return trimToBudget(
    (count) => {
      const pageItems = visible.slice(input.offset, input.offset + count)
      const page = makePage(input.offset, input.limit, pageItems.length, visible.length)
      const omittedElements = sliceLength - pageItems.length
      const result = {
        ok: true as const,
        detail: input.detail,
        sceneVersion,
        findings: pageItems,
        overlaps,
        labelIssues,
        arrowIssues,
        missingIds,
        page,
        truncation: {
          truncated: omittedElements > 0 || page.nextOffset !== null,
          fields: [] as string[],
          omittedElements,
          serializedBytes: 0,
          budgetBytes: budget
        }
      }
      settleSerializedBytes(result)
      return result
    },
    sliceLength,
    budget
  )
}
