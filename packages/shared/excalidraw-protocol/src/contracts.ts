import { z } from 'zod'
import {
  clearInputSchema,
  drawInputSchema,
  editInputSchema,
  EXCALIDRAW_DETAIL_LEVELS,
  inspectInputSchema,
  readInputSchema,
  searchInputSchema
} from './inputs'

export const editableFieldSchema = z.enum([
  'x',
  'y',
  'width',
  'height',
  'angleDegrees',
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roughness',
  'opacity',
  'locked',
  'text'
])
export const editRestrictionSchema = z.enum([
  'locked',
  'relationship-geometry',
  'unsupported-geometry',
  'unsupported-resize',
  'unsupported-text',
  'container-text',
  'fixed-text'
])

const capabilitiesSchema = z
  .object({
    editableFields: z.array(editableFieldSchema),
    requiresUnlock: z.boolean(),
    restrictions: z.array(editRestrictionSchema)
  })
  .strict()

const boundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative()
  })
  .strict()
const elementStyleSchema = z
  .object({
    strokeColor: z.string(),
    backgroundColor: z.string(),
    fillStyle: z.string(),
    strokeWidth: z.number(),
    strokeStyle: z.string(),
    roughness: z.number(),
    opacity: z.number()
  })
  .strict()
const boundElementSchema = z.object({ id: z.string(), type: z.string() }).strict()
const labelSchema = z.object({ elementId: z.string(), text: z.string() }).strict()
const pointSchema = z.tuple([z.number(), z.number()])
const pointBindingSchema = z
  .object({
    elementId: z.string(),
    focus: z.number(),
    gap: z.number(),
    fixedPoint: pointSchema.optional()
  })
  .strict()

const commonShape = {
  id: z.string(),
  type: z.string(),
  version: z.number().int().nonnegative(),
  zIndex: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angleDegrees: z.number(),
  style: elementStyleSchema,
  locked: z.boolean(),
  groupIds: z.array(z.string()),
  frameId: z.string().nullable(),
  link: z.string().nullable(),
  boundElements: z.array(boundElementSchema),
  label: labelSchema.optional(),
  capabilities: capabilitiesSchema
}

const shapeElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('shape'),
    type: z.enum(['rectangle', 'ellipse', 'diamond'])
  })
  .strict()
const textElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('text'),
    type: z.literal('text'),
    text: z
      .object({
        text: z.string(),
        originalText: z.string(),
        fontSize: z.number(),
        fontFamily: z.number(),
        textAlign: z.string(),
        verticalAlign: z.string(),
        containerId: z.string().nullable(),
        autoResize: z.boolean(),
        lineHeight: z.number()
      })
      .strict()
      .optional()
  })
  .strict()
const linearShape = {
  points: z.array(pointSchema),
  startBinding: pointBindingSchema.nullable(),
  endBinding: pointBindingSchema.nullable(),
  startArrowhead: z.string().nullable(),
  endArrowhead: z.string().nullable(),
  elbowed: z.boolean().optional()
}
const lineElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('line'),
    type: z.literal('line'),
    linear: z.object(linearShape).strict().optional()
  })
  .strict()
const arrowElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('arrow'),
    type: z.literal('arrow'),
    linear: z.object(linearShape).strict().optional()
  })
  .strict()
const freeDrawElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('freeDraw'),
    type: z.literal('freedraw'),
    freeDraw: z
      .object({
        points: z.array(pointSchema),
        pressures: z.array(z.number()),
        simulatePressure: z.boolean()
      })
      .strict()
      .optional()
  })
  .strict()
const imageElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('image'),
    type: z.literal('image'),
    image: z
      .object({
        fileId: z.string().nullable(),
        status: z.string(),
        scale: pointSchema,
        crop: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
            naturalWidth: z.number(),
            naturalHeight: z.number()
          })
          .strict()
          .nullable()
      })
      .strict()
      .optional()
  })
  .strict()
const frameElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('frame'),
    type: z.enum(['frame', 'magicframe']),
    frameName: z.string().nullable().optional()
  })
  .strict()
const embedElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('embed'),
    type: z.enum(['embeddable', 'iframe'])
  })
  .strict()
const unsupportedElementSchema = z
  .object({
    ...commonShape,
    kind: z.literal('unsupported'),
    unsupportedType: z.string()
  })
  .strict()

export const readElementSchema = z.discriminatedUnion('kind', [
  shapeElementSchema,
  textElementSchema,
  lineElementSchema,
  arrowElementSchema,
  freeDrawElementSchema,
  imageElementSchema,
  frameElementSchema,
  embedElementSchema,
  unsupportedElementSchema
])

const truncationSchema = z
  .object({
    truncated: z.boolean(),
    fields: z.array(z.string()),
    omittedElements: z.number().int().nonnegative(),
    serializedBytes: z.number().int().nonnegative(),
    budgetBytes: z.number().int().positive()
  })
  .strict()
const pageSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable()
  })
  .strict()
const pageResultShape = {
  detail: z.enum(EXCALIDRAW_DETAIL_LEVELS),
  sceneVersion: z.number().int().nonnegative(),
  page: pageSchema,
  truncation: truncationSchema
}

const drawResultSchema = z
  .object({ ok: z.literal(true), drawn: z.number().int().nonnegative(), replaced: z.boolean() })
  .strict()
const searchElementSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string().optional(),
    bounds: boundsSchema,
    zIndex: z.number().int().nonnegative(),
    selected: z.boolean()
  })
  .strict()
const searchResultSchema = z
  .object({
    ok: z.literal(true),
    sceneCount: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    elements: z.array(searchElementSchema),
    ...pageResultShape
  })
  .strict()
const inspectElementSchema = searchElementSchema
  .extend({
    locked: z.boolean(),
    groupIds: z.array(z.string()).optional(),
    frameId: z.string().nullable().optional(),
    boundElementIds: z.array(z.string()).optional()
  })
  .strict()
const selectionSchema = z
  .object({
    elementIds: z.array(z.string()),
    groupIds: z.array(z.string()),
    editingGroupId: z.string().nullable()
  })
  .strict()
const viewportSchema = boundsSchema
  .extend({ scrollX: z.number(), scrollY: z.number(), zoom: z.number().positive() })
  .strict()
const sceneSummarySchema = z
  .object({
    elementCount: z.number().int().nonnegative(),
    visibleElementCount: z.number().int().nonnegative(),
    typeCounts: z.record(z.string(), z.number().int().nonnegative()),
    bounds: boundsSchema.nullable(),
    viewport: viewportSchema,
    selection: selectionSchema,
    theme: z.string(),
    backgroundColor: z.string(),
    grid: z
      .object({ enabled: z.boolean(), size: z.number().positive(), step: z.number().positive() })
      .strict()
  })
  .strict()
const inspectResultSchema = z
  .object({
    ok: z.literal(true),
    scene: sceneSummarySchema,
    elements: z.array(inspectElementSchema),
    missingIds: z.array(z.string()),
    ...pageResultShape
  })
  .strict()
export const readResultSchema = z
  .object({
    ok: z.literal(true),
    elements: z.array(readElementSchema),
    missingIds: z.array(z.string()),
    ...pageResultShape
  })
  .strict()
const editReceiptSchema = z
  .object({ id: z.string(), version: z.number().int().nonnegative() })
  .strict()
const editResultSchema = z
  .object({
    ok: z.literal(true),
    updated: z.number().int().nonnegative(),
    receipts: z.array(editReceiptSchema),
    elements: z.array(readElementSchema),
    truncation: truncationSchema
  })
  .strict()
const clearResultSchema = z.object({ ok: z.literal(true) }).strict()

export const excalidrawVerbContracts = {
  draw: { inputSchema: drawInputSchema, resultSchema: drawResultSchema },
  search: { inputSchema: searchInputSchema, resultSchema: searchResultSchema },
  inspect: { inputSchema: inspectInputSchema, resultSchema: inspectResultSchema },
  read: { inputSchema: readInputSchema, resultSchema: readResultSchema },
  edit: { inputSchema: editInputSchema, resultSchema: editResultSchema },
  clear: { inputSchema: clearInputSchema, resultSchema: clearResultSchema }
} as const

export type EditableField = z.infer<typeof editableFieldSchema>
export type EditRestriction = z.infer<typeof editRestrictionSchema>
export type ReadElement = z.infer<typeof readElementSchema>
export type ReadResult = z.infer<typeof readResultSchema>
