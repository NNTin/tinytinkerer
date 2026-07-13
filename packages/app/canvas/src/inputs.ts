import { z } from 'zod'
export { EXCALIDRAW_LIBRARY_CHANNEL } from './library-channel'

export const EXCALIDRAW_ELEMENT_LIMIT = 50
export const EXCALIDRAW_SEARCH_DEFAULT_LIMIT = 20
export const EXCALIDRAW_DETAIL_LEVELS = ['summary', 'standard', 'full'] as const

// Selectable keys for `pick`/`read`'s optional `fields` projection. Identity
// (`id`/`type`/`kind`) is always returned and deliberately excluded from this list —
// a caller can never project it away. Mirrors `commonShape` in contracts.ts (minus
// the identity keys) plus the per-kind detail blocks (`text`/`linear`/`freeDraw`/
// `image`/`frameName`); kept in sync by the contracts test guard.
export const ELEMENT_PROJECTION_FIELDS = [
  'version',
  'zIndex',
  'x',
  'y',
  'width',
  'height',
  'angleDegrees',
  'style',
  'locked',
  'groupIds',
  'frameId',
  'link',
  'boundElements',
  'label',
  'capabilities',
  'text',
  'linear',
  'freeDraw',
  'image',
  'frameName'
] as const
export const elementFieldSchema = z
  .enum(ELEMENT_PROJECTION_FIELDS)
  .describe(
    'A projectable element field. Identity keys id/type/kind are always included and are ' +
      'not listed here. Include "version" if you plan to edit the elements afterwards — ' +
      'mutations are version-checked. Styling properties (strokeColor, backgroundColor, ' +
      'fillStyle, strokeWidth, strokeStyle, roughness, opacity) are not separate fields — ' +
      'request "style" to get them all.'
  )
export type ElementField = (typeof ELEMENT_PROJECTION_FIELDS)[number]
// Default distance a bound connector endpoint keeps from its target's edge. Kept
// here (not imported from Excalidraw) so the schema vocabulary stays side-effect
// free and the stage owns the exact anchoring math.
export const EXCALIDRAW_DEFAULT_BINDING_GAP = 4

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
  transform: { request: 32 * 1_024, result: 64 * 1_024 },
  bind: { request: 16 * 1_024, result: 64 * 1_024 },
  audit: { request: 16 * 1_024, result: 64 * 1_024 },
  snap: { request: 16 * 1_024, result: 64 * 1_024 },
  place: { request: 16 * 1_024, result: 64 * 1_024 },
  arrange: { request: 16 * 1_024, result: 64 * 1_024 },
  survey: { request: 16 * 1_024, result: 64 * 1_024 },
  preset: { request: 16 * 1_024, result: 64 * 1_024 },
  icon: { request: 16 * 1_024, result: 64 * 1_024 },
  // 32 KiB → 160 KiB: the result may now carry an optional rendered PNG of the
  // hypothetical (unapplied) scene alongside the patch summary — thumbnail's
  // own image budget is 128 KiB, so this leaves headroom for the summary too.
  preview: { request: 64 * 1_024, result: 160 * 1_024 },
  thumbnail: { request: 4 * 1_024, result: 128 * 1_024 },
  pick: { request: 4 * 1_024, result: 64 * 1_024 }
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

// Paging guard shared by every verb that spreads `pagingShape`: resuming past
// the first page requires the scene version the caller paged from, so a scene
// change mid-pagination is rejected instead of silently skewing pages.
type PagedInput = z.output<z.ZodObject<typeof pagingShape>>

const withPagingGuard = <Schema extends z.ZodType<PagedInput>>(schema: Schema): Schema =>
  schema.superRefine((input, ctx) => {
    if (input.offset > 0 && input.expectedSceneVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSceneVersion'],
        message: 'Required after offset 0.'
      })
    }
  })

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
  width: z
    .number()
    .finite()
    .optional()
    .describe(
      'Width in pixels. May be negative for a line/arrow drawn leftward (the endpoint sits left of x); for shapes a negative width just draws from the opposite corner.'
    ),
  height: z
    .number()
    .finite()
    .optional()
    .describe(
      'Height in pixels. May be negative for a line/arrow drawn upward (the endpoint sits above y); for shapes a negative height just draws from the opposite corner.'
    ),
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
        'Declarative post-layout connectors. The canvas controller computes endpoints from final node bounds so same-row links stay horizontal and trunks stay vertical.'
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

export const searchInputSchema = withPagingGuard(
  z
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
)

export const inspectInputSchema = withPagingGuard(
  z
    .object({
      elementIds: uniqueElementIdsSchema.optional(),
      ...pagingShape
    })
    .strict()
)

// `fields` is orthogonal to `detail`: `detail` still governs which type-specific
// blocks (text/points caps, etc.) get built and how far their strings/arrays are
// truncated; `fields` then narrows which of the built keys make it into the
// record. Omit `fields` for today's full records, byte-for-byte unchanged.
const fieldsProjectionField = z
  .array(elementFieldSchema)
  .min(1)
  .max(ELEMENT_PROJECTION_FIELDS.length)
  .optional()
  .describe('Return only these fields per element (plus id/type/kind). Omit for full records.')

export const readInputSchema = withPagingGuard(
  z
    .object({
      elementIds: uniqueElementIdsSchema,
      fields: fieldsProjectionField,
      ...pagingShape
    })
    .strict()
)

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

// Structural editing verbs operate on a set of existing elements. Concurrency is
// versioned by default: whenever operands are passed explicitly, each is a
// `{ id, expectedVersion }` ref AND `expectedSceneVersion` is required, so the
// mutation rejects (before any scene update) if either the element or the scene
// drifted since the caller read it. Omitting `elements` falls back to the live
// canvas selection — the one un-versioned convenience path.
const versionedElementRefSchema = z
  .object({
    id: elementIdSchema,
    expectedVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('The element version from a prior read; rejects stale edits.')
  })
  .strict()

const versionedElementsSchema = z
  .array(versionedElementRefSchema)
  .min(1)
  .max(EXCALIDRAW_ELEMENT_LIMIT)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.id)).size === refs.length,
    'Element ids must be unique.'
  )

const expectedSceneVersionField = {
  expectedSceneVersion: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Scene version from a prior read/inspect. Required when `elements` is passed; rejects the edit if the scene changed.'
    )
}

// Explicit operands are versioned; selection fallback is not. Shared by the
// selection-capable structural verbs.
const selectionOperandShape = {
  elements: versionedElementsSchema
    .optional()
    .describe('Versioned element refs to operate on. Omit to use the current canvas selection.'),
  ...expectedSceneVersionField
}
const requireSceneVersionWithElements = (
  input: { elements?: unknown; expectedSceneVersion?: unknown },
  ctx: z.RefinementCtx
): void => {
  if (input.elements !== undefined && input.expectedSceneVersion === undefined)
    ctx.addIssue({
      code: 'custom',
      path: ['expectedSceneVersion'],
      message: 'Required when elements are passed explicitly by id.'
    })
}

export const groupInputSchema = z
  .object({
    operation: z
      .enum(['group', 'ungroup'])
      .describe(
        'group: enclose the elements in one new group. ungroup: remove their outermost group.'
      ),
    ...selectionOperandShape
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

export const duplicateInputSchema = z
  .object({
    elements: versionedElementsSchema.describe('Versioned refs of the elements to duplicate.'),
    offset: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .default({ x: 10, y: 10 })
      .describe('Canvas-pixel offset applied to every duplicated element.'),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
  })
  .strict()

export const deleteInputSchema = z
  .object({
    elements: versionedElementsSchema.describe('Versioned refs of the elements to delete.'),
    includeRelated: z
      .boolean()
      .default(false)
      .describe(
        'Allow the delete to cross relationships (cascade bound labels, frame children, and detach connectors). When false, such a delete is rejected instead of silently cascading.'
      ),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
  })
  .strict()

export const alignInputSchema = z
  .object({
    ...selectionOperandShape,
    axis: z
      .enum(['x', 'y'])
      .describe('x aligns left/center/right edges; y aligns top/middle/bottom edges.'),
    position: z
      .enum(['start', 'center', 'end'])
      .describe('start = left/top edge, center = center line, end = right/bottom edge.')
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

export const distributeInputSchema = z
  .object({
    ...selectionOperandShape,
    axis: z
      .enum(['x', 'y'])
      .describe('x spaces elements evenly left-to-right; y spaces them top-to-bottom.')
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

export const stackInputSchema = z
  .object({
    ...selectionOperandShape,
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
      .describe('Cross-axis alignment relative to the first element.')
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

export const orderInputSchema = z
  .object({
    ...selectionOperandShape,
    operation: z
      .enum(['front', 'back', 'forward', 'backward'])
      .describe('front/back jump to the top/bottom of the z-stack; forward/backward step by one.')
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

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
    reflowConnectors: z
      .boolean()
      .default(false)
      .describe(
        'When true, connectors bound to a moved or resized shape follow their endpoints (re-anchored to the deterministic edge policy) instead of the move/resize being rejected for distorting a binding.'
      ),
    ...expectedSceneVersionField
  })
  .strict()

// Connector binding verbs. `bind` (re)binds or detaches a connector endpoint;
// `audit` is a read that reports binding health. Both are part of the connectors
// & bindings slice and consume the same versioned-ref + paging vocabulary as the
// structural verbs and reads.

// Where a connector endpoint attaches on its target. `focus` is the perpendicular
// offset along the chosen edge (-1..1, 0 centers it) and `gap` is the distance the
// endpoint keeps from the edge. The canvas controller picks the facing edge deterministically
// from the opposite endpoint, so the connector stays readable after move/resize.
const bindingAnchorSchema = z
  .object({
    focus: z
      .number()
      .finite()
      .min(-1)
      .max(1)
      .default(0)
      .describe('Offset along the target edge, -1..1; 0 centers the endpoint.'),
    gap: z
      .number()
      .finite()
      .nonnegative()
      .default(EXCALIDRAW_DEFAULT_BINDING_GAP)
      .describe('Distance in canvas pixels the endpoint keeps from the target edge.')
  })
  .strict()

const bindEndpointSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('attach'),
      target: versionedElementRefSchema.describe(
        'Versioned ref of the shape this endpoint should bind to.'
      ),
      anchor: bindingAnchorSchema
        .default({ focus: 0, gap: EXCALIDRAW_DEFAULT_BINDING_GAP })
        .describe('Anchor/focus point on the target. Defaults to a centered, gapped edge anchor.')
    })
    .strict(),
  z
    .object({ action: z.literal('detach') })
    .strict()
    .describe('Free this endpoint: clear its binding and leave it at its current point.')
])

export const bindInputSchema = z
  .object({
    connector: versionedElementRefSchema.describe(
      'Versioned ref of the arrow or line whose endpoints to (re)bind.'
    ),
    start: bindEndpointSchema.optional().describe('Change the start endpoint binding.'),
    end: bindEndpointSchema.optional().describe('Change the end endpoint binding.'),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
  })
  .strict()
  .refine(
    (input) => input.start !== undefined || input.end !== undefined,
    'Provide a start and/or end binding change.'
  )

export const auditInputSchema = withPagingGuard(
  z
    .object({
      connectorIds: uniqueElementIdsSchema
        .optional()
        .describe('Connector ids to audit. Omit to audit every connector in the scene.'),
      ...pagingShape
    })
    .strict()
)

// Layout helper verbs. `snap`/`place`/`arrange` are writes that reposition
// elements (carrying labels/frame children and re-anchoring bound connectors);
// `survey` is a read that reports layout health. They consume the same
// versioned-ref + paging vocabulary as the structural verbs and reads.

const gridSizeSchema = z
  .number()
  .finite()
  .positive()
  .describe('Grid spacing in canvas pixels. Defaults to the live scene grid size when omitted.')

export const snapInputSchema = z
  .object({
    ...selectionOperandShape,
    gridSize: gridSizeSchema.optional(),
    snapSize: z
      .boolean()
      .default(false)
      .describe('Also round width/height to the grid (resizable shapes only).')
  })
  .strict()
  .superRefine(requireSceneVersionWithElements)

const placeAnchorSchema = z.union([
  z
    .object({ elementId: elementIdSchema.describe('Anchor element to position relative to.') })
    .strict(),
  z
    .object({ groupId: z.string().min(1).describe('Anchor group to position relative to.') })
    .strict()
])

export const placeInputSchema = z
  .object({
    elements: versionedElementsSchema.describe(
      'Versioned refs of the elements to move as one cluster, preserving their relative arrangement.'
    ),
    anchor: placeAnchorSchema.describe('The reference element or group to position relative to.'),
    relation: z
      .enum(['below', 'above', 'left-of', 'right-of', 'center-over'])
      .describe(
        'Where to put the cluster relative to the anchor. center-over centers it on the anchor.'
      ),
    gap: z
      .number()
      .finite()
      .nonnegative()
      .default(20)
      .describe(
        'Gap in canvas pixels between the cluster and the anchor edge (ignored for center-over).'
      ),
    align: z
      .enum(['start', 'center', 'end'])
      .default('center')
      .describe('Cross-axis alignment relative to the anchor (ignored for center-over).'),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
  })
  .strict()

const arrangeGridSchema = z
  .object({
    pattern: z.literal('grid'),
    columns: z.number().int().positive().optional().describe('Number of columns (row-major fill).'),
    rows: z.number().int().positive().optional().describe('Number of rows.'),
    gapX: z.number().finite().nonnegative().default(20).describe('Horizontal gap between cells.'),
    gapY: z.number().finite().nonnegative().default(20).describe('Vertical gap between cells.')
  })
  .strict()
const arrangeCircleSchema = z
  .object({
    pattern: z.literal('circle'),
    radius: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe('Circle radius in canvas pixels; derived from the cluster when omitted.'),
    center: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional()
      .describe('Circle center in canvas coordinates; the cluster center when omitted.')
  })
  .strict()

export const arrangeInputSchema = z
  .object({
    elements: versionedElementsSchema.describe(
      'Versioned refs of the elements to arrange, in the order they should be laid out.'
    ),
    layout: z
      .discriminatedUnion('pattern', [arrangeGridSchema, arrangeCircleSchema])
      .describe('The arrangement: a row-major grid or an evenly spaced circle.'),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .describe('Scene version from a prior read/inspect; rejects the edit if the scene changed.')
  })
  .strict()

export const surveyInputSchema = withPagingGuard(
  z
    .object({
      elementIds: uniqueElementIdsSchema
        .optional()
        .describe('Limit the survey to these elements. Omit to survey the whole scene.'),
      checks: z
        .array(z.enum(['overlap', 'label', 'arrow']))
        .min(1)
        .max(3)
        .refine((checks) => new Set(checks).size === checks.length, 'Checks must be unique.')
        .optional()
        .describe('Which checks to run. Defaults to all: overlap, label, arrow.'),
      ...pagingShape
    })
    .strict()
)
// Diagram-semantics verbs. `preset` inserts a ready-made diagram scaffold
// (network / flowchart / UML / wireframe) and `icon` inserts one or more
// infrastructure glyphs (router, laptop, phone, cloud, server, printer) as
// grouped, labeled shape elements. Both are fully offline: every glyph is encoded
// locally as Excalidraw element skeletons — nothing is fetched from
// libraries.excalidraw.com (or anywhere) at runtime, so they work inside the
// integrated stage. Insertion is atomic and undoable (one scene update) and
// version-checked via the optional `expectedSceneVersion` (rejects if the scene
// drifted since the caller read it).

export const EXCALIDRAW_ICON_TYPES = [
  'router',
  'laptop',
  'phone',
  'cloud',
  'server',
  'printer'
] as const

export const EXCALIDRAW_PRESET_KINDS = ['network', 'flowchart', 'uml', 'wireframe'] as const

// Each icon expands into a handful of primitives, so cap a single batch well
// under EXCALIDRAW_ELEMENT_LIMIT converted elements.
export const EXCALIDRAW_ICON_LIMIT = 12

const iconTypeSchema = z.enum(EXCALIDRAW_ICON_TYPES).describe('Infrastructure icon to insert.')

// Shared version guard for the inserts: clear-first flag plus the optional
// scene-version check. Inserts append by default, so the check is opt-in.
const insertionGuardShape = {
  replace: z
    .boolean()
    .default(false)
    .describe('Clear the canvas before inserting instead of appending.'),
  expectedSceneVersion: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Scene version from a prior read/inspect. When provided, the insertion is rejected if the scene changed since (version-checked).'
    )
}

const iconSpecSchema = z
  .object({
    type: iconTypeSchema,
    x: z.number().finite().describe('Left position of this icon in canvas coordinates.'),
    y: z.number().finite().describe('Top position of this icon in canvas coordinates.'),
    label: z
      .string()
      .trim()
      .min(1)
      .max(EXCALIDRAW_FIELD_LIMITS.name)
      .optional()
      .describe('Override the default caption. Defaults to the icon type, e.g. "Router".')
  })
  .strict()

export const iconInputSchema = z
  .object({
    icons: z
      .array(iconSpecSchema)
      .min(1)
      .max(EXCALIDRAW_ICON_LIMIT)
      .describe('Infrastructure icons to insert, each positioned in canvas coordinates.'),
    ...insertionGuardShape
  })
  .strict()

// Common controls for a diagram preset: where to anchor it, an optional heading,
// and the shared insertion guard.
const presetOriginShape = {
  x: z
    .number()
    .finite()
    .default(0)
    .describe('Left position of the inserted scaffold in canvas coordinates.'),
  y: z
    .number()
    .finite()
    .default(0)
    .describe('Top position of the inserted scaffold in canvas coordinates.'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(EXCALIDRAW_FIELD_LIMITS.name)
    .optional()
    .describe('Optional heading drawn above the preset.'),
  ...insertionGuardShape
}

// The valid variants per kind. `preset` is a single flat object (not a
// discriminated union) so its tool schema has an object root — model function-call
// APIs (e.g. OpenAI/ChatGPT) reject a top-level union/`anyOf` for a tool's
// parameters. A superRefine enforces the kind→variant pairing, and the builder
// defaults an omitted variant to the first for the kind.
export const EXCALIDRAW_PRESET_VARIANTS = {
  network: ['star', 'edge'],
  flowchart: ['linear', 'decision'],
  uml: ['class', 'sequence', 'usecase'],
  wireframe: ['screen', 'modal']
} as const

export const presetInputSchema = z
  .object({
    kind: z.enum(EXCALIDRAW_PRESET_KINDS).describe('The kind of diagram scaffold to insert.'),
    variant: z
      .enum([
        'star',
        'edge',
        'linear',
        'decision',
        'class',
        'sequence',
        'usecase',
        'screen',
        'modal'
      ])
      .optional()
      .describe(
        'Variant within the kind. network: star (central router → device icons) or edge (internet cloud → router → server). flowchart: linear (start → process → end) or decision (adds a decision diamond with Yes/No). uml: class, sequence, or usecase. wireframe: screen or modal. Defaults to the first variant for the kind.'
      ),
    ...presetOriginShape
  })
  .strict()
  .superRefine((input, ctx) => {
    const allowed: readonly string[] = EXCALIDRAW_PRESET_VARIANTS[input.kind]
    if (input.variant !== undefined && !allowed.includes(input.variant))
      ctx.addIssue({
        code: 'custom',
        path: ['variant'],
        message: `variant "${input.variant}" is not valid for kind "${input.kind}"; use one of: ${allowed.join(', ')}.`
      })
  })

// Safer-iterative-workflow verbs. `preview` dry-runs any mutating verb (validates
// and executes its real behavior against a capture wrapper that suppresses the
// commit, then diffs before/after into a compact patch summary) so the model can
// see what a write would do before committing to it; the versioned input IS the
// staged plan, and applying is just calling the target verb with the same input.
// `thumbnail` renders an on-demand, byte-budgeted PNG snapshot for visual
// verification. `pick` is the interactive/selection read: `current` returns the
// live selection now, `interactive` prompts the user (toast) and waits for their
// next settled selection, reusing the issue-#85 human-input-tool machinery.

// Exactly the mutating verbs — reads have nothing to dry-run, and `preview`
// cannot preview itself (there is no commit to suppress for a dry-run).
export const EXCALIDRAW_PREVIEWABLE_VERBS = [
  'draw',
  'edit',
  'clear',
  'group',
  'duplicate',
  'delete',
  'align',
  'distribute',
  'stack',
  'order',
  'transform',
  'bind',
  'snap',
  'place',
  'arrange',
  'preset',
  'icon'
] as const

// Shared bounds for the exported-image "longest edge" dimension, reused by
// `preview`'s optional render and `thumbnail`'s snapshot so the two schemas
// can't drift apart — both ultimately render through the same
// canvas `renderScenePng` helper.
export const EXCALIDRAW_THUMBNAIL_MAX_DIMENSION_BOUNDS = {
  min: 64,
  max: 1024,
  default: 512
} as const

const maxDimensionSchema = z
  .number()
  .int()
  .min(EXCALIDRAW_THUMBNAIL_MAX_DIMENSION_BOUNDS.min)
  .max(EXCALIDRAW_THUMBNAIL_MAX_DIMENSION_BOUNDS.max)
  .default(EXCALIDRAW_THUMBNAIL_MAX_DIMENSION_BOUNDS.default)
  .describe('Longest edge of the exported image in pixels; the export is scaled to fit.')

export const previewInputSchema = z
  .object({
    verb: z.enum(EXCALIDRAW_PREVIEWABLE_VERBS).describe('The mutating verb to dry-run.'),
    input: z
      .record(z.string(), z.unknown())
      .describe(
        "The exact input you would pass to that verb. It is validated against the verb's own schema and runs the verb's real checks (versions, locks, relationships) without committing."
      ),
    render: z
      .boolean()
      .default(true)
      .describe(
        'Render a PNG of the hypothetical (unapplied) result alongside the patch summary. Set false for a summary-only, faster dry-run.'
      ),
    maxDimension: maxDimensionSchema
  })
  .strict()

export const thumbnailInputSchema = z
  .object({
    elementIds: uniqueElementIdsSchema
      .optional()
      .describe('Limit the snapshot to these elements. Omit to capture the whole scene.'),
    maxDimension: maxDimensionSchema,
    background: z
      .boolean()
      .default(true)
      .describe('Include the canvas background color. false exports a transparent background.'),
    expectedSceneVersion: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Scene version from a prior read/inspect. When provided, the snapshot is rejected if the scene changed since (version-checked).'
      )
  })
  .strict()

// An interactive pick request must outlive the wait the canvas
// does for the user; the canvas derives its per-request timeout from this so
// the two budgets cannot drift apart.
export const EXCALIDRAW_PICK_MAX_TIMEOUT_SECONDS = 120

export const pickInputSchema = z
  .object({
    mode: z
      .enum(['current', 'interactive'])
      .default('current')
      .describe(
        'current: return the live canvas selection now. interactive: prompt the user (toast) and wait for their next selection.'
      ),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'interactive only: the toast message shown to the user. Defaults to "Select element(s) on the canvas".'
      ),
    timeoutSeconds: z
      .number()
      .int()
      .min(5)
      .max(EXCALIDRAW_PICK_MAX_TIMEOUT_SECONDS)
      .default(60)
      .describe('interactive only: how long to wait for the user before returning timedOut:true.'),
    detail: z.enum(EXCALIDRAW_DETAIL_LEVELS).default('standard'),
    fields: fieldsProjectionField
  })
  .strict()

// Schema version for a persisted scene snapshot. The `version` is a literal in the
// schema below so a snapshot written by an older/newer build fails validation and
// the stage falls back to an empty scene instead of feeding the canvas a shape it
// can no longer interpret. Bump this only when the snapshot payload shape changes.
export const EXCALIDRAW_SNAPSHOT_VERSION = 1

// A persisted scene snapshot: the live (non-deleted) elements plus a curated slice
// of view state, and any imported library items. Elements/library items are kept
// opaque (the full Excalidraw records the app produced) so a restore round-trips
// losslessly; volatile appState (selection, editing ids, collaborators, cursor) is
// intentionally excluded.
export const excalidrawSnapshotSchema = z
  .object({
    version: z.literal(EXCALIDRAW_SNAPSHOT_VERSION),
    elements: z.array(z.record(z.string(), z.unknown())),
    appState: z.record(z.string(), z.unknown()).optional(),
    libraryItems: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .strict()

// Allow only official Excalidraw library URLs to be fetched by the relay, mirroring
// Excalidraw's own default `validateLibraryUrl` allow-list. Guards the shell against
// being pointed at an arbitrary origin via a crafted `addLibrary` parameter.
export const isAllowedLibraryUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url)
    return (
      protocol === 'https:' &&
      (hostname === 'excalidraw.com' || hostname.endsWith('.excalidraw.com'))
    )
  } catch {
    return false
  }
}

// OBJECT-ROOT INVARIANT: every schema in this map is forwarded verbatim as a
// tool's `function.parameters`, so it must convert to an object-root JSON schema
// (no top-level union/array). Enforced fail-fast by `toolInputJsonSchema` in
// packages/shared/contracts/src/tool-schema.ts and re-asserted per verb in
// tests/contracts.test.ts ('renders an object-root JSON schema for every verb').
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
  transform: transformInputSchema,
  bind: bindInputSchema,
  audit: auditInputSchema,
  snap: snapInputSchema,
  place: placeInputSchema,
  arrange: arrangeInputSchema,
  survey: surveyInputSchema,
  preset: presetInputSchema,
  icon: iconInputSchema,
  preview: previewInputSchema,
  thumbnail: thumbnailInputSchema,
  pick: pickInputSchema
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
export type BindInput = z.infer<typeof bindInputSchema>
export type AuditInput = z.infer<typeof auditInputSchema>
export type SnapInput = z.infer<typeof snapInputSchema>
export type PlaceInput = z.infer<typeof placeInputSchema>
export type ArrangeInput = z.infer<typeof arrangeInputSchema>
export type SurveyInput = z.infer<typeof surveyInputSchema>
export type PresetInput = z.infer<typeof presetInputSchema>
export type IconInput = z.infer<typeof iconInputSchema>
export type IconType = (typeof EXCALIDRAW_ICON_TYPES)[number]
export type PresetKind = (typeof EXCALIDRAW_PRESET_KINDS)[number]
export type PreviewInput = z.infer<typeof previewInputSchema>
export type ThumbnailInput = z.infer<typeof thumbnailInputSchema>
export type PickInput = z.infer<typeof pickInputSchema>
export type PreviewableVerb = (typeof EXCALIDRAW_PREVIEWABLE_VERBS)[number]
export type ExcalidrawSnapshot = z.infer<typeof excalidrawSnapshotSchema>
