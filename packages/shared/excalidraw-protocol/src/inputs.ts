import { z } from 'zod'

export const EXCALIDRAW_APP_ID = 'excalidraw'
// generic app-bridge envelope version. Bumped to 5 for the persistence snapshot
// restore contract (host-replayed scene on reload), then to 6 for the connectors
// & bindings and layout-helper verbs.
export const EXCALIDRAW_PROTOCOL_VERSION = 6
export const EXCALIDRAW_ELEMENT_LIMIT = 50
export const EXCALIDRAW_SEARCH_DEFAULT_LIMIT = 20
export const EXCALIDRAW_DETAIL_LEVELS = ['summary', 'standard', 'full'] as const
// Default distance a bound connector endpoint keeps from its target's edge. Kept
// here (not imported from Excalidraw) so the wire vocabulary stays side-effect
// free; the iframe owns the exact anchoring math.
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
  survey: { request: 16 * 1_024, result: 64 * 1_024 }
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
// endpoint keeps from the edge. The iframe picks the facing edge deterministically
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

export const auditInputSchema = z
  .object({
    connectorIds: uniqueElementIdsSchema
      .optional()
      .describe('Connector ids to audit. Omit to audit every connector in the scene.'),
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

export const surveyInputSchema = z
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
  .superRefine((input, ctx) => {
    if (input.offset > 0 && input.expectedSceneVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedSceneVersion'],
        message: 'Required after offset 0.'
      })
    }
  })
// Schema version for a persisted scene snapshot. The `version` is a literal in the
// schema below so a snapshot written by an older/newer build fails validation and
// the harness falls back to an empty scene instead of feeding the canvas a shape it
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

// Reserved system verb (not model-facing): the canvas shell calls this to push a
// library, fetched by its same-origin callback relay, into the sandboxed iframe. The
// iframe cannot receive the libraries.excalidraw.com round-trip directly (opaque
// origin + nonce), so the shell relays the `.excalidrawlib` content over the bridge.
export const EXCALIDRAW_LIBRARY_IMPORT_VERB = 'excalidraw:import-library'

// Same-origin BroadcastChannel name shared by the library callback page (which
// receives the libraries.excalidraw.com return navigation in a new tab) and the live
// canvas shell (which forwards the library into the iframe).
export const EXCALIDRAW_LIBRARY_CHANNEL = 'tinytinkerer:canvas-library'

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

// Input for the library import system verb: the raw `.excalidrawlib` JSON text, which
// the iframe hands to Excalidraw's own Blob loader (so parsing/normalization stays in
// the upstream component).
export const excalidrawLibraryImportSchema = z.object({ content: z.string().min(1) }).strict()

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
  survey: surveyInputSchema
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
export type ExcalidrawSnapshot = z.infer<typeof excalidrawSnapshotSchema>
export type ExcalidrawLibraryImport = z.infer<typeof excalidrawLibraryImportSchema>
