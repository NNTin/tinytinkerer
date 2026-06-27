import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tool } from '@tinytinkerer/app-browser'
import { createCanvasTools } from './canvas-tools'
import { setCanvasApi } from './canvas-bridge'

// Mock the heavy Excalidraw library the tools dynamic-import inside execute(): a
// faithful-enough stand-in so we can assert the mapping without loading the real
// (DOM/canvas) package.
const captureUpdate = { IMMEDIATELY: 'immediately', EVENTUALLY: 'eventually', NEVER: 'never' }
vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: captureUpdate,
  convertToExcalidrawElements: (skeleton: Array<Record<string, unknown>>) =>
    skeleton.map((element, index) => ({ id: `converted-${index}`, ...element }))
}))

type FakeApi = {
  updateScene: ReturnType<typeof vi.fn>
  getSceneElements: ReturnType<typeof vi.fn>
  scrollToContent: ReturnType<typeof vi.fn>
}

const fakeApi = (sceneElements: unknown[] = []): FakeApi => ({
  updateScene: vi.fn(),
  getSceneElements: vi.fn(() => sceneElements),
  scrollToContent: vi.fn()
})

const getTool = (id: string): Tool<unknown, unknown> => {
  const tool = createCanvasTools().find((candidate) => candidate.id === id)
  if (!tool) {
    throw new Error(`Canvas tool not found: ${id}`)
  }
  return tool
}

const run = (tool: Tool<unknown, unknown>, input: unknown): Promise<unknown> =>
  tool.execute(tool.schema.parse(input))

beforeEach(() => {
  setCanvasApi(null)
})

describe('canvas tools', () => {
  it('exposes draw, read, and clear tools', () => {
    expect(
      createCanvasTools()
        .map((tool) => tool.id)
        .sort()
    ).toEqual(['clear_canvas', 'draw_on_canvas', 'read_canvas'])
  })

  it('draw_on_canvas converts elements and updates the scene undoably', async () => {
    const api = fakeApi()
    // Cast through unknown: the tools only use the methods the fake provides.
    setCanvasApi(api as unknown as Parameters<typeof setCanvasApi>[0])

    const result = await run(getTool('draw_on_canvas'), {
      elements: [
        { type: 'rectangle', x: 10, y: 20, width: 100, height: 50, text: 'Box' },
        { type: 'text', x: 0, y: 0, text: 'Hello' }
      ]
    })

    expect(result).toEqual({ ok: true, drawn: 2, replaced: false })
    expect(api.updateScene).toHaveBeenCalledTimes(1)
    const sceneArg = api.updateScene.mock.calls[0]![0] as {
      elements: unknown[]
      captureUpdate: string
    }
    expect(sceneArg.elements).toHaveLength(2)
    // Assistant draws land on the undo stack so the user can revert them.
    expect(sceneArg.captureUpdate).toBe(captureUpdate.IMMEDIATELY)
    expect(api.scrollToContent).toHaveBeenCalledTimes(1)
  })

  it('draw_on_canvas appends to existing elements unless replace is set', async () => {
    const api = fakeApi([{ id: 'existing-1' }])
    setCanvasApi(api as unknown as Parameters<typeof setCanvasApi>[0])

    await run(getTool('draw_on_canvas'), {
      elements: [{ type: 'ellipse', x: 5, y: 5 }]
    })
    const appended = api.updateScene.mock.calls[0]![0] as { elements: unknown[] }
    expect(appended.elements).toHaveLength(2) // existing + 1 new

    api.updateScene.mockClear()
    await run(getTool('draw_on_canvas'), {
      elements: [{ type: 'ellipse', x: 5, y: 5 }],
      replace: true
    })
    const replaced = api.updateScene.mock.calls[0]![0] as { elements: unknown[] }
    expect(replaced.elements).toHaveLength(1) // only the new element
  })

  it('read_canvas summarizes the current scene', async () => {
    const api = fakeApi([
      { id: 'a', type: 'rectangle', x: 1.4, y: 2.6, width: 10.2, height: 20.8, text: 'hi' },
      { id: 'b', type: 'ellipse', x: 0, y: 0, width: 5, height: 5 }
    ])
    setCanvasApi(api as unknown as Parameters<typeof setCanvasApi>[0])

    const result = (await run(getTool('read_canvas'), {})) as {
      ok: boolean
      count: number
      truncated: boolean
      elements: Array<Record<string, unknown>>
    }

    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(result.truncated).toBe(false)
    expect(result.elements[0]).toEqual({
      id: 'a',
      type: 'rectangle',
      x: 1,
      y: 3,
      width: 10,
      height: 21,
      text: 'hi'
    })
    // No text key when an element has none.
    expect(result.elements[1]).not.toHaveProperty('text')
  })

  it('clear_canvas empties the scene', async () => {
    const api = fakeApi([{ id: 'x' }])
    setCanvasApi(api as unknown as Parameters<typeof setCanvasApi>[0])

    const result = await run(getTool('clear_canvas'), {})

    expect(result).toEqual({ ok: true })
    const sceneArg = api.updateScene.mock.calls[0]![0] as { elements: unknown[] }
    expect(sceneArg.elements).toEqual([])
  })

  it('every tool degrades gracefully when the canvas is not mounted', async () => {
    setCanvasApi(null)

    for (const tool of createCanvasTools()) {
      const result = (await run(tool, { elements: [{ type: 'rectangle', x: 0, y: 0 }] })) as {
        ok: boolean
        error?: string
      }
      expect(result.ok, `${tool.id} should fail gracefully`).toBe(false)
      expect(result.error).toBeTypeOf('string')
    }
  })
})
