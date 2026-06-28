import { z } from 'zod'
import {
  clearInputSchema,
  drawInputSchema,
  editInputSchema,
  inspectInputSchema,
  readInputSchema,
  searchInputSchema
} from './inputs'

const boundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
})

const selectionSchema = z.object({
  elementIds: z.array(z.string()),
  groupIds: z.array(z.string()),
  editingGroupId: z.string().nullable()
})

const viewportSchema = boundsSchema.extend({
  scrollX: z.number(),
  scrollY: z.number(),
  zoom: z.number().positive()
})

const gridSchema = z.object({
  enabled: z.boolean(),
  size: z.number().positive(),
  step: z.number().positive()
})

const elementStyleSchema = z.object({
  strokeColor: z.string(),
  backgroundColor: z.string(),
  fillStyle: z.string(),
  strokeWidth: z.number(),
  strokeStyle: z.string(),
  roughness: z.number(),
  opacity: z.number()
})

const boundElementSchema = z.object({
  id: z.string(),
  type: z.string()
})

const labelSchema = z.object({
  elementId: z.string(),
  text: z.string()
})

const pointSchema = z.tuple([z.number(), z.number()])

const pointBindingSchema = z.object({
  elementId: z.string(),
  focus: z.number(),
  gap: z.number(),
  fixedPoint: pointSchema.optional()
})

const textContentSchema = z.object({
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

const linearContentSchema = z.object({
  points: z.array(pointSchema),
  startBinding: pointBindingSchema.nullable(),
  endBinding: pointBindingSchema.nullable(),
  startArrowhead: z.string().nullable(),
  endArrowhead: z.string().nullable(),
  elbowed: z.boolean().optional()
})

const freeDrawContentSchema = z.object({
  points: z.array(pointSchema),
  pressures: z.array(z.number()),
  simulatePressure: z.boolean()
})

const imageCropSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  naturalWidth: z.number(),
  naturalHeight: z.number()
})

const imageContentSchema = z.object({
  fileId: z.string().nullable(),
  status: z.string(),
  scale: pointSchema,
  crop: imageCropSchema.nullable()
})

const drawResultSchema = z.object({
  ok: z.literal(true),
  drawn: z.number().int().nonnegative(),
  replaced: z.boolean()
})

const searchElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().optional(),
  bounds: boundsSchema,
  zIndex: z.number().int().nonnegative(),
  selected: z.boolean()
})

const searchResultSchema = z.object({
  ok: z.literal(true),
  sceneCount: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  truncated: z.boolean(),
  elements: z.array(searchElementSchema)
})

const inspectElementSchema = searchElementSchema.extend({
  locked: z.boolean(),
  groupIds: z.array(z.string()),
  frameId: z.string().nullable(),
  boundElementIds: z.array(z.string())
})

const sceneSummarySchema = z.object({
  elementCount: z.number().int().nonnegative(),
  visibleElementCount: z.number().int().nonnegative(),
  typeCounts: z.record(z.string(), z.number().int().nonnegative()),
  bounds: boundsSchema.nullable(),
  viewport: viewportSchema,
  selection: selectionSchema,
  theme: z.string(),
  backgroundColor: z.string(),
  grid: gridSchema
})

const inspectResultSchema = z.object({
  ok: z.literal(true),
  scene: sceneSummarySchema,
  elements: z.array(inspectElementSchema),
  missingIds: z.array(z.string())
})

export const readElementSchema = z.object({
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
  text: textContentSchema.optional(),
  linear: linearContentSchema.optional(),
  freeDraw: freeDrawContentSchema.optional(),
  image: imageContentSchema.optional(),
  frameName: z.string().nullable().optional()
})

export const readResultSchema = z.object({
  ok: z.literal(true),
  elements: z.array(readElementSchema),
  missingIds: z.array(z.string())
})

const editResultSchema = z.object({
  ok: z.literal(true),
  updated: z.number().int().nonnegative(),
  elements: z.array(readElementSchema)
})

const clearResultSchema = z.object({
  ok: z.literal(true)
})

export const excalidrawVerbContracts = {
  draw: {
    inputSchema: drawInputSchema,
    resultSchema: drawResultSchema
  },
  search: {
    inputSchema: searchInputSchema,
    resultSchema: searchResultSchema
  },
  inspect: {
    inputSchema: inspectInputSchema,
    resultSchema: inspectResultSchema
  },
  read: {
    inputSchema: readInputSchema,
    resultSchema: readResultSchema
  },
  edit: {
    inputSchema: editInputSchema,
    resultSchema: editResultSchema
  },
  clear: {
    inputSchema: clearInputSchema,
    resultSchema: clearResultSchema
  }
} as const

export type ReadElement = z.infer<typeof readElementSchema>
export type ReadResult = z.infer<typeof readResultSchema>
