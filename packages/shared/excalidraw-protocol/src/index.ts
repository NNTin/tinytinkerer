import { APP_BRIDGE_PROTOCOL_VERSION } from '@tinytinkerer/app-bridge'
import { z } from 'zod'

export const EXCALIDRAW_APP_ID = 'excalidraw'
export const EXCALIDRAW_PROTOCOL_VERSION = APP_BRIDGE_PROTOCOL_VERSION
export const EXCALIDRAW_READ_LIMIT = 100

const colorSchema = z
  .string()
  .min(1)
  .describe('A CSS color, for example "#e03131", "transparent", or a named color.')

export const drawElementSchema = z.object({
  type: z
    .enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'])
    .describe('The kind of element to draw.'),
  x: z.number().finite().describe('Left position in canvas coordinates.'),
  y: z.number().finite().describe('Top position in canvas coordinates.'),
  width: z.number().finite().nonnegative().optional().describe('Width in pixels.'),
  height: z.number().finite().nonnegative().optional().describe('Height in pixels.'),
  text: z.string().optional().describe('Text content, or an optional centered label for a shape.'),
  strokeColor: colorSchema.optional(),
  backgroundColor: colorSchema.optional()
})

export const drawInputSchema = z.object({
  elements: z
    .array(drawElementSchema)
    .min(1)
    .describe('Elements to draw, positioned in canvas coordinates.'),
  replace: z.boolean().optional().describe('Clear the canvas before drawing instead of appending.')
})

export const readInputSchema = z.object({}).strict()
export const clearInputSchema = z.object({}).strict()

const drawResultSchema = z.object({
  ok: z.literal(true),
  drawn: z.number().int().nonnegative(),
  replaced: z.boolean()
})

const readElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  text: z.string().optional()
})

export const readResultSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  elements: z.array(readElementSchema),
  appState: z.object({
    scrollX: z.number(),
    scrollY: z.number(),
    zoom: z.number(),
    theme: z.string()
  })
})

const clearResultSchema = z.object({
  ok: z.literal(true)
})

export const excalidrawVerbContracts = {
  draw: {
    inputSchema: drawInputSchema,
    resultSchema: drawResultSchema
  },
  read: {
    inputSchema: readInputSchema,
    resultSchema: readResultSchema
  },
  clear: {
    inputSchema: clearInputSchema,
    resultSchema: clearResultSchema
  }
} as const

export const EXCALIDRAW_VERBS = Object.freeze(
  Object.keys(excalidrawVerbContracts) as Array<keyof typeof excalidrawVerbContracts>
)

export type DrawElement = z.infer<typeof drawElementSchema>
export type DrawInput = z.infer<typeof drawInputSchema>
export type ReadInput = z.infer<typeof readInputSchema>
export type ClearInput = z.infer<typeof clearInputSchema>
export type ReadResult = z.infer<typeof readResultSchema>
