import { z } from 'zod'

export const EXCALIDRAW_APP_ID = 'excalidraw'
// Version of the Excalidraw verb contracts, intentionally independent from the
// generic app-bridge envelope version.
export const EXCALIDRAW_PROTOCOL_VERSION = 4
export const EXCALIDRAW_ELEMENT_LIMIT = 50
export const EXCALIDRAW_SEARCH_DEFAULT_LIMIT = 20
export const EXCALIDRAW_DETAIL_LEVELS = ['summary', 'standard', 'full'] as const

export const EXCALIDRAW_FIELD_LIMITS = Object.freeze({
  name: 160,
  standardText: 2_048,
  fullText: 8_192,
  points: 1_024,
  relationships: 256,
  groups: 64
})

export const EXCALIDRAW_PAYLOAD_BUDGETS = Object.freeze({
  search: { request: 8 * 1_024, result: 16 * 1_024 },
  inspect: { request: 16 * 1_024, result: 32 * 1_024 },
  read: { request: 16 * 1_024, result: 64 * 1_024 },
  draw: { request: 64 * 1_024, result: 64 * 1_024 },
  edit: { request: 64 * 1_024, result: 64 * 1_024 },
  clear: { request: 1 * 1_024, result: 1 * 1_024 },
  group: { request: 16 * 1_024, result: 64 * 1_024 },
  duplicate: { request: 16 * 1_024, result: 64 * 1_024 },
  delete: { request: 16 * 1_024, result: 16 * 1_024 },
  align: { request: 16 * 1_024, result: 64 * 1_024 },
  distribute: { request: 16 * 1_024, result: 64 * 1_024 },
  stack: { request: 16 * 1_024, result: 64 * 1_024 },
  order: { request: 16 * 1_024, result: 64 * 1_024 },
  transform: { request: 32 * 1_024, result: 64 * 1_024 }
})

const colorSchema = z
  .string()
  .min(1)
  .describe('A CSS color, for example "#e03131", "transparent", or a named color.')

const elementIdSchema = z.string().min(1).describe('An element id returned by a canvas tool.')

const uniqueElementIdsSchema = z
  .array(elementIdSchema)
  .min(1)
  .max(EXCALIDRAW_ELEMENT_LIMIT)
  .refine((ids) => new Set(ids).size === ids.length, 'Element ids must be unique.')

const pagingShape = {
  offset: z.number().int().nonnegative().default(0),
  limit: z
    .number()
    .int()
    .min(1)
    .max(EXCALIDRAW_ELEMENT_LIMIT)
    .default(EXCALIDRAW_SEARCH_DEFAULT_LIMIT),
  expectedSceneVersion: z.number().int().nonnegative().optional(),
  detail: z.enum(EXCALIDRAW_DETAIL_LEVELS).default('standard')
}

export const drawElementSchema = z.object({
  id: elementIdSchema
    .optional()
    .describe(
      'Optional stable id for this newly drawn element. Supply ids for shapes that connectors reference.'
    ),
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

const drawEndpointSchema = z.union([
  z
    .object({
      elementId: elementIdSchema.describe('Existing or newly drawn element id to anchor to.'),
      side: z.enum(['auto', 'left', 'right', 'top', 'bottom', 'center']).default('auto')
    })
    .strict(),
  z
    .object({
      x: z.number().finite().describe('Absolute x coordinate in canvas coordinates.'),
      y: z.number().finite().describe('Absolute y coordinate in canvas coordinates.')
    })
    .strict()
])

export const drawConnectorSchema = z
  .object({
    id: elementIdSchema.optional().describe('Optional stable id for the connector.'),
    type: z.enum(['arrow', 'line']).default('arrow'),
    from: drawEndpointSchema.describe('Start endpoint.'),
    to: drawEndpointSchema.describe('End endpoint.'),
    routing: z
      .enum(['auto', 'horizontal', 'vertical'])
      .default('auto')
      .describe(
        'Connector route. Use horizontal with rowY for same-row diagram links and vertical with trunkX for trunks.'
      ),
    rowY: z
      .number()
      .finite()
      .optional()
      .describe('Forced shared y coordinate for horizontal row connectors.'),
    trunkX: z
      .number()
      .finite()
      .optional()
      .describe('Forced shared x coordinate for vertical trunk connectors.'),
    text: z.string().optional().describe('Optional centered connector label.'),
    strokeColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional()
  })
  .strict()

export const drawInputSchema = z
  .object({
    elements: z
      .array(drawElementSchema)
      .max(EXCALIDRAW_ELEMENT_LIMIT)
      .default([])
      .describe('Elements to draw, positioned in canvas coordinates.'),
    connectors: z
      .array(drawConnectorSchema)
      .max(EXCALIDRAW_ELEMENT_LIMIT)
      .default([])
      .describe(
        'Declarative post-layout connectors. The iframe computes endpoints from final node bounds so same-row links stay horizontal and trunks stay vertical.'
      ),
    replace: z
      .boolean()
      .optional()
      .describe('Clear the canvas before drawing instead of appending.')
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.elements.length === 0 && input.connectors.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['elements'],
        message: 'At least one element or connector is required.'
      })
    }
    if (input.elements.length + input.connectors.length > EXCALIDRAW_ELEMENT_LIMIT) {
      ctx.addIssue({
        code: 'custom',
        path: ['elements'],
        message: `At most ${EXCALIDRAW_ELEMENT_LIMIT} elements and connectors are allowed.`
      })
    }
    const ids = [...input.elements, ...input.connectors]
      .map(({ id }) => id)
      .filter((id): id is string => typeof id === 'string')
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['elements'],
        message: 'Draw element and connector ids must be unique.'
      })
    }
  })

export const searchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Case-insensitive text matched against element id, type, text, label, or frame name.'
      ),
    types: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .refine((types) => new Set(types).size === types.length, 'Element types must be unique.')
      .optional(),
    scope: z.enum(['all', 'selection', 'viewport']).default('all'),
    ...pagingShape
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.offset > 0 && input.expectedSceneVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSceneVersion'],
        message: 'Required after offset 0.'
      })
    }
  })

export const inspectInputSchema = z
  .object({
    elementIds: uniqueElementIdsSchema.optional(),
    ...pagingShape
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.offset > 0 && input.expectedSceneVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSceneVersion'],
        message: 'Required after offset 0.'
      })
    }
  })

export const readInputSchema = z
  .object({
    elementIds: uniqueElementIdsSchema,
    ...pagingShape
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.offset > 0 && input.expectedSceneVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSceneVersion'],
        message: 'Required after offset 0.'
      })
    }
  })

export const editChangesSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    angleDegrees: z.number().finite().optional(),
    strokeColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    fillStyle: z.enum(['hachure', 'cross-hatch', 'solid', 'zigzag']).optional(),
    strokeWidth: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    roughness: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    opacity: z.number().int().min(0).max(100).optional(),
    locked: z.boolean().optional(),
    text: z.string().optional()
  })
  .strict()
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'At least one change is required.'
  )

const editItemSchema = z.object({
  id: elementIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  changes: editChangesSchema
})

export const editInputSchema = z
  .object({
    edits: z
      .array(editItemSchema)
      .min(1)
      .max(EXCALIDRAW_ELEMENT_LIMIT)
      .refine(
        (edits) => new Set(edits.map((edit) => edit.id)).size === edits.length,
        'Edit element ids must be unique.'
      )
  })
  .strict()

export const clearInputSchema = z.object({}).strict()

// Structural editing verbs operate on a set of existing elements. When
// `elementIds` is omitted they fall back to the live canvas selection, which is
// why the field is optional here but still validated for uniqueness when given.
// `expectedSceneVersion` is the optimistic concurrency guard: supply the
// `sceneVersion` from a prior read/inspect to make the mutation reject if the
// scene drifted underneath you.
const selectionTargetIdsSchema = uniqueElementIdsSchema
  .optional()
  .describe('Element ids to operate on. Omit to use the current canvas selection.')
const expectedSceneVersionField = {
  expectedSceneVersion: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
}

export const groupInputSchema = z
  .object({
    operation: z
      .enum(['group', 'ungroup'])
      .describe(
        'group: enclose the elements in one new group. ungroup: remove their outermost group.'
      ),
    elementIds: selectionTargetIdsSchema,
    ...expectedSceneVersionField
  })
  .strict()

export const duplicateInputSchema = z
  .object({
    elementIds: uniqueElementIdsSchema.describe('Existing element ids to duplicate.'),
    offset: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .default({ x: 10, y: 10 })
      .describe('Canvas-pixel offset applied to every duplicated element.'),
    ...expectedSceneVersionField
  })
  .strict()

export const deleteInputSchema = z
  .object({
    elementIds: uniqueElementIdsSchema.describe('Existing element ids to delete.'),
    ...expectedSceneVersionField
  })
  .strict()

export const alignInputSchema = z
  .object({
    elementIds: selectionTargetIdsSchema,
    axis: z
      .enum(['x', 'y'])
      .describe('x aligns left/center/right edges; y aligns top/middle/bottom edges.'),
    position: z
      .enum(['start', 'center', 'end'])
      .describe('start = left/top edge, center = center line, end = right/bottom edge.'),
    ...expectedSceneVersionField
  })
  .strict()

export const distributeInputSchema = z
  .object({
    elementIds: selectionTargetIdsSchema,
    axis: z
      .enum(['x', 'y'])
      .describe('x spaces elements evenly left-to-right; y spaces them top-to-bottom.'),
    ...expectedSceneVersionField
  })
  .strict()

export const stackInputSchema = z
  .object({
    elementIds: selectionTargetIdsSchema,
    direction: z
      .enum(['horizontal', 'vertical'])
      .describe('Lay the elements out left-to-right or top-to-bottom in the given order.'),
    spacing: z
      .number()
      .finite()
      .nonnegative()
      .default(20)
      .describe('Gap in canvas pixels between consecutive elements.'),
    align: z
      .enum(['start', 'center', 'end'])
      .default('center')
      .describe('Cross-axis alignment relative to the first element.'),
    ...expectedSceneVersionField
  })
  .strict()

export const orderInputSchema = z
  .object({
    elementIds: selectionTargetIdsSchema,
    operation: z
      .enum(['front', 'back', 'forward', 'backward'])
      .describe('front/back jump to the top/bottom of the z-stack; forward/backward step by one.'),
    ...expectedSceneVersionField
  })
  .strict()

const transformResizeSchema = z
  .object({
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional()
  })
  .strict()
  .refine(
    (resize) => resize.width !== undefined || resize.height !== undefined,
    'resize requires width or height.'
  )

const transformItemSchema = z
  .object({
    id: elementIdSchema,
    expectedVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('The element version from a prior read; rejects stale edits.'),
    move: z
      .object({ dx: z.number().finite(), dy: z.number().finite() })
      .strict()
      .optional()
      .describe('Translate by this delta, carrying labels and frame children.'),
    resize: transformResizeSchema.optional()
  })
  .strict()
  .refine(
    (item) => item.move !== undefined || item.resize !== undefined,
    'Each transform requires move or resize.'
  )

export const transformInputSchema = z
  .object({
    elements: z
      .array(transformItemSchema)
      .min(1)
      .max(EXCALIDRAW_ELEMENT_LIMIT)
      .refine(
        (elements) => new Set(elements.map((element) => element.id)).size === elements.length,
        'Transform element ids must be unique.'
      ),
    ...expectedSceneVersionField
  })
  .strict()

export const excalidrawVerbInputSchemas = {
  draw: drawInputSchema,
  search: searchInputSchema,
  inspect: inspectInputSchema,
  read: readInputSchema,
  edit: editInputSchema,
  clear: clearInputSchema,
  group: groupInputSchema,
  duplicate: duplicateInputSchema,
  delete: deleteInputSchema,
  align: alignInputSchema,
  distribute: distributeInputSchema,
  stack: stackInputSchema,
  order: orderInputSchema,
  transform: transformInputSchema
} as const

export const EXCALIDRAW_VERBS = Object.freeze(
  Object.keys(excalidrawVerbInputSchemas) as Array<keyof typeof excalidrawVerbInputSchemas>
)

export type DrawElement = z.infer<typeof drawElementSchema>
export type DrawConnector = z.infer<typeof drawConnectorSchema>
export type DrawInput = z.infer<typeof drawInputSchema>
export type SearchInput = z.infer<typeof searchInputSchema>
export type InspectInput = z.infer<typeof inspectInputSchema>
export type ReadInput = z.infer<typeof readInputSchema>
export type EditInput = z.infer<typeof editInputSchema>
export type EditChanges = z.infer<typeof editChangesSchema>
export type ClearInput = z.infer<typeof clearInputSchema>
export type GroupInput = z.infer<typeof groupInputSchema>
export type DuplicateInput = z.infer<typeof duplicateInputSchema>
export type DeleteInput = z.infer<typeof deleteInputSchema>
export type AlignInput = z.infer<typeof alignInputSchema>
export type DistributeInput = z.infer<typeof distributeInputSchema>
export type StackInput = z.infer<typeof stackInputSchema>
export type OrderInput = z.infer<typeof orderInputSchema>
export type TransformInput = z.infer<typeof transformInputSchema>
