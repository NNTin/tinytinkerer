import { getCommonBounds, hashElementsVersion } from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  OrderedExcalidrawElement
} from '@excalidraw/excalidraw/element/types'
import { EXCALIDRAW_FIELD_LIMITS } from '@tinytinkerer/excalidraw-protocol'
import type {
  EditableField,
  EditRestriction,
  ReadElement,
  ReadInput
} from '@tinytinkerer/excalidraw-protocol'
import { truncateUtf8 } from './payload'

export type DetailLevel = ReadInput['detail']
export type NormalizedElement = { element: ReadElement; truncatedFields: string[] }

const STYLE_FIELDS: EditableField[] = [
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'locked'
]
const POSITION_FIELDS: EditableField[] = ['x', 'y', 'angleDegrees']
const RESIZE_FIELDS: EditableField[] = ['width', 'height']
const supportedTypes = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'line',
  'arrow',
  'freedraw',
  'image',
  'frame',
  'magicframe',
  'embeddable',
  'iframe'
])

export const sceneVersionOf = (elements: readonly OrderedExcalidrawElement[]): number =>
  hashElementsVersion(elements)

export const elementMap = (elements: readonly OrderedExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, element]))

export const compactBounds = (element: ExcalidrawElement) => {
  const [x1, y1, x2, y2] = getCommonBounds([element])
  return {
    x: Math.round(x1),
    y: Math.round(y1),
    width: Math.max(0, Math.round(x2 - x1)),
    height: Math.max(0, Math.round(y2 - y1))
  }
}

const boundedString = (value: string, limit: number, path: string, truncated: string[]): string => {
  const result = truncateUtf8(value, limit)
  if (result !== value) truncated.push(path)
  return result
}
const boundedArray = <T>(
  value: readonly T[],
  limit: number,
  path: string,
  truncated: string[]
): T[] => {
  if (value.length > limit) truncated.push(path)
  return value.slice(0, limit)
}

export const labelFor = (
  element: ExcalidrawElement,
  byId: ReadonlyMap<string, ExcalidrawElement>
) => {
  const reference = element.boundElements?.find((bound) => bound.type === 'text')
  const label = reference ? byId.get(reference.id) : undefined
  return label?.type === 'text' ? { elementId: label.id, text: label.text } : undefined
}

export const displayNameFor = (
  element: ExcalidrawElement,
  byId: ReadonlyMap<string, ExcalidrawElement>
): string | undefined => {
  if (element.type === 'text') return element.text
  const label = labelFor(element, byId)
  if (label) return label.text
  if (element.type === 'frame' || element.type === 'magicframe') return element.name ?? undefined
  return undefined
}

export const hasRelationship = (
  target: ExcalidrawElement,
  elements: readonly OrderedExcalidrawElement[]
): boolean => {
  if (target.groupIds.length || target.frameId || target.boundElements?.length) return true
  if (target.type === 'text' && target.containerId) return true
  if (
    (target.type === 'line' || target.type === 'arrow') &&
    (target.startBinding || target.endBinding)
  )
    return true
  return elements.some(
    (element) =>
      element.id !== target.id &&
      (element.frameId === target.id ||
        (element.type === 'text' && element.containerId === target.id) ||
        ((element.type === 'line' || element.type === 'arrow') &&
          (element.startBinding?.elementId === target.id ||
            element.endBinding?.elementId === target.id)))
  )
}

export const capabilitiesFor = (
  element: OrderedExcalidrawElement,
  elements: readonly OrderedExcalidrawElement[]
) => {
  const relationships = hasRelationship(element, elements)
  const restrictions: EditRestriction[] = []
  if (element.locked) restrictions.push('locked')
  if (relationships) restrictions.push('relationship-geometry')
  if (!['rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow'].includes(element.type))
    restrictions.push('unsupported-geometry')
  if (!['rectangle', 'ellipse', 'diamond'].includes(element.type))
    restrictions.push('unsupported-resize')
  if (element.type !== 'text') restrictions.push('unsupported-text')
  if (element.type === 'text' && element.containerId) restrictions.push('container-text')
  if (element.type === 'text' && !element.autoResize) restrictions.push('fixed-text')

  const editableFields: EditableField[] = [...STYLE_FIELDS]
  if (
    !relationships &&
    ['rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow'].includes(element.type)
  )
    editableFields.push(...POSITION_FIELDS)
  if (!relationships && ['rectangle', 'ellipse', 'diamond'].includes(element.type))
    editableFields.push(...RESIZE_FIELDS)
  if (
    element.type === 'text' &&
    !relationships &&
    element.containerId === null &&
    element.autoResize
  )
    editableFields.push('text')
  return { editableFields, requiresUnlock: element.locked, restrictions }
}

const binding = (value: ExcalidrawLinearElement['startBinding']) => {
  if (!value) return null
  const fixedPoint =
    'fixedPoint' in value && Array.isArray(value.fixedPoint)
      ? (value.fixedPoint as [number, number])
      : null
  return {
    elementId: value.elementId,
    focus: value.focus,
    gap: value.gap,
    ...(fixedPoint ? { fixedPoint: [fixedPoint[0], fixedPoint[1]] as [number, number] } : {})
  }
}

export const normalizeElement = (
  element: OrderedExcalidrawElement,
  zIndex: number,
  elements: readonly OrderedExcalidrawElement[],
  detail: DetailLevel
): NormalizedElement => {
  const truncatedFields: string[] = []
  const byId = elementMap(elements)
  const label = labelFor(element, byId)
  const common = {
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
    groupIds: boundedArray(
      element.groupIds,
      EXCALIDRAW_FIELD_LIMITS.groups,
      'groupIds',
      truncatedFields
    ),
    frameId: element.frameId,
    link:
      element.link === null
        ? null
        : boundedString(element.link, EXCALIDRAW_FIELD_LIMITS.fullText, 'link', truncatedFields),
    boundElements: boundedArray(
      element.boundElements ?? [],
      EXCALIDRAW_FIELD_LIMITS.relationships,
      'boundElements',
      truncatedFields
    ).map(({ id, type }) => ({ id, type })),
    ...(label
      ? {
          label: {
            ...label,
            text: boundedString(
              label.text,
              detail === 'full'
                ? EXCALIDRAW_FIELD_LIMITS.fullText
                : EXCALIDRAW_FIELD_LIMITS.standardText,
              'label.text',
              truncatedFields
            )
          }
        }
      : {}),
    capabilities: capabilitiesFor(element, elements)
  }
  const includeDetail = detail !== 'summary'
  if (element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'diamond')
    return { element: { ...common, kind: 'shape', type: element.type }, truncatedFields }
  if (element.type === 'text') {
    const limit =
      detail === 'full' ? EXCALIDRAW_FIELD_LIMITS.fullText : EXCALIDRAW_FIELD_LIMITS.standardText
    return {
      element: {
        ...common,
        kind: 'text',
        type: 'text',
        ...(includeDetail
          ? {
              text: {
                text: boundedString(element.text, limit, 'text.text', truncatedFields),
                originalText: boundedString(
                  element.originalText,
                  limit,
                  'text.originalText',
                  truncatedFields
                ),
                fontSize: element.fontSize,
                fontFamily: element.fontFamily,
                textAlign: element.textAlign,
                verticalAlign: element.verticalAlign,
                containerId: element.containerId,
                autoResize: element.autoResize,
                lineHeight: element.lineHeight
              }
            }
          : {})
      },
      truncatedFields
    }
  }
  if (element.type === 'line' || element.type === 'arrow') {
    const cap = detail === 'full' ? EXCALIDRAW_FIELD_LIMITS.points : 256
    const linear = includeDetail
      ? {
          points: boundedArray(element.points, cap, 'linear.points', truncatedFields).map(
            ([x, y]) => [x, y] as [number, number]
          ),
          startBinding: binding(element.startBinding),
          endBinding: binding(element.endBinding),
          startArrowhead: element.startArrowhead,
          endArrowhead: element.endArrowhead,
          ...('elbowed' in element && typeof element.elbowed === 'boolean'
            ? { elbowed: element.elbowed }
            : {})
        }
      : undefined
    if (element.type === 'line') {
      return {
        element: { ...common, kind: 'line', type: 'line', ...(linear ? { linear } : {}) },
        truncatedFields
      }
    }
    return {
      element: { ...common, kind: 'arrow', type: 'arrow', ...(linear ? { linear } : {}) },
      truncatedFields
    }
  }
  if (element.type === 'freedraw') {
    const cap = detail === 'full' ? EXCALIDRAW_FIELD_LIMITS.points : 256
    return {
      element: {
        ...common,
        kind: 'freeDraw',
        type: 'freedraw',
        ...(includeDetail
          ? {
              freeDraw: {
                points: boundedArray(element.points, cap, 'freeDraw.points', truncatedFields).map(
                  ([x, y]) => [x, y] as [number, number]
                ),
                pressures: boundedArray(
                  element.pressures,
                  cap,
                  'freeDraw.pressures',
                  truncatedFields
                ),
                simulatePressure: element.simulatePressure
              }
            }
          : {})
      },
      truncatedFields
    }
  }
  if (element.type === 'image')
    return {
      element: {
        ...common,
        kind: 'image',
        type: 'image',
        ...(includeDetail
          ? {
              image: {
                fileId: element.fileId,
                status: element.status,
                scale: [element.scale[0], element.scale[1]],
                crop: element.crop
              }
            }
          : {})
      },
      truncatedFields
    }
  if (element.type === 'frame' || element.type === 'magicframe')
    return {
      element: {
        ...common,
        kind: 'frame',
        type: element.type,
        ...(includeDetail
          ? {
              frameName:
                element.name === null
                  ? null
                  : boundedString(
                      element.name,
                      EXCALIDRAW_FIELD_LIMITS.name,
                      'frameName',
                      truncatedFields
                    )
            }
          : {})
      },
      truncatedFields
    }
  if (element.type === 'embeddable' || element.type === 'iframe')
    return { element: { ...common, kind: 'embed', type: element.type }, truncatedFields }
  return {
    element: {
      ...common,
      kind: 'unsupported',
      unsupportedType: supportedTypes.has(element.type) ? 'unknown' : element.type
    },
    truncatedFields
  }
}
