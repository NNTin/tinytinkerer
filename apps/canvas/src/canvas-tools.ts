import type { Tool } from '@tinytinkerer/app-browser'
import { z } from 'zod'
import { getCanvasApi } from './canvas-bridge'

// App-local chat tools that let the assistant draw on and read the live Excalidraw
// canvas. They are passed to createBrowserShellRoot's `appTools` (always-on, not a
// plugin) and close over the canvas bridge. @excalidraw/excalidraw is imported
// DYNAMICALLY inside execute() so it never lands in the startup entry chunk — it
// is already loaded by the time the assistant draws (the canvas mounted it), and
// the dynamic import resolves to the same lazy excalidraw-vendor chunk.

const NOT_READY = {
  ok: false as const,
  error: 'The canvas is not ready yet. Ask the user to wait a moment and try again.'
}

const COLOR = z.string().describe('A CSS color, e.g. "#e03131", "transparent", or a named color.')

const drawElementSchema = z.object({
  type: z
    .enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'])
    .describe('The kind of element to draw.'),
  x: z.number().describe('Left position in canvas coordinates.'),
  y: z.number().describe('Top position in canvas coordinates.'),
  width: z.number().optional().describe('Width in pixels (ignored for text).'),
  height: z.number().optional().describe('Height in pixels (ignored for text).'),
  text: z
    .string()
    .optional()
    .describe('For "text", the text content; for shapes, an optional centered label.'),
  strokeColor: COLOR.optional(),
  backgroundColor: COLOR.optional()
})

type DrawElement = z.infer<typeof drawElementSchema>

const drawInputSchema = z.object({
  elements: z
    .array(drawElementSchema)
    .min(1)
    .describe('The elements to draw, positioned in canvas coordinates.'),
  replace: z
    .boolean()
    .optional()
    .describe('When true, clear the canvas first; otherwise add to the existing drawing.')
})

const emptyInputSchema = z.object({})

// Map our simplified, model-friendly element shape onto an Excalidraw element
// skeleton (the input convertToExcalidrawElements expects).
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

const createDrawTool = (): Tool<z.infer<typeof drawInputSchema>, unknown> => ({
  id: 'draw_on_canvas',
  description:
    'Draw one or more shapes, text, arrows, or lines on the Excalidraw whiteboard the user is ' +
    'looking at. Use canvas coordinates (x/y from the top-left, pixels). By default new elements ' +
    'are added to the existing drawing; pass replace:true to start fresh. Call read_canvas first ' +
    'if you need to position elements relative to what is already there.',
  schema: drawInputSchema,
  async execute(input) {
    const api = getCanvasApi()
    if (!api) {
      return NOT_READY
    }

    const { convertToExcalidrawElements, CaptureUpdateAction } =
      await import('@excalidraw/excalidraw')

    const skeleton = input.elements.map(buildSkeleton)
    const converted = convertToExcalidrawElements(
      skeleton as Parameters<typeof convertToExcalidrawElements>[0]
    )
    const existing = input.replace ? [] : api.getSceneElements()

    api.updateScene({
      elements: [...existing, ...converted],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    // Frame what was just drawn so the user sees it.
    api.scrollToContent(converted, { fitToContent: true })

    return { ok: true, drawn: converted.length, replaced: input.replace === true }
  }
})

const createReadTool = (): Tool<z.infer<typeof emptyInputSchema>, unknown> => ({
  id: 'read_canvas',
  description:
    'Read the current contents of the Excalidraw whiteboard so you can describe it or add to it. ' +
    'Returns each element with its type, position, size, and any text.',
  schema: emptyInputSchema,
  execute() {
    const api = getCanvasApi()
    if (!api) {
      return Promise.resolve(NOT_READY)
    }

    const all = api.getSceneElements()
    const LIMIT = 100
    const elements = all.slice(0, LIMIT).map((element) => {
      const maybeText = (element as { text?: unknown }).text
      return {
        id: element.id,
        type: element.type,
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width),
        height: Math.round(element.height),
        ...(typeof maybeText === 'string' && maybeText.length > 0 ? { text: maybeText } : {})
      }
    })

    return Promise.resolve({
      ok: true,
      count: all.length,
      truncated: all.length > LIMIT,
      elements
    })
  }
})

const createClearTool = (): Tool<z.infer<typeof emptyInputSchema>, unknown> => ({
  id: 'clear_canvas',
  description: 'Remove everything from the Excalidraw whiteboard, leaving a blank canvas.',
  schema: emptyInputSchema,
  async execute() {
    const api = getCanvasApi()
    if (!api) {
      return NOT_READY
    }

    const { CaptureUpdateAction } = await import('@excalidraw/excalidraw')
    api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY })

    return { ok: true }
  }
})

// The always-on canvas tool set handed to createBrowserShellRoot's `appTools`.
export const createCanvasTools = (): Tool<unknown, unknown>[] => [
  createDrawTool(),
  createReadTool(),
  createClearTool()
]
