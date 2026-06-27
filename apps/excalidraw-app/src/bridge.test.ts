import { describe, expect, it, vi } from 'vitest'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createExcalidrawHandlers } from './bridge'

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({ id: `converted-${index}`, ...element }))
}))

const fakeApi = (elements: unknown[] = []) =>
  ({
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({
      scrollX: 10.4,
      scrollY: -5.6,
      zoom: { value: 0.75 },
      theme: 'light'
    })),
    updateScene: vi.fn(),
    scrollToContent: vi.fn()
  }) as unknown as ExcalidrawImperativeAPI

const run = (
  api: ExcalidrawImperativeAPI,
  verb: 'draw' | 'read' | 'clear',
  payload: unknown
): Promise<unknown> => {
  const registration = createExcalidrawHandlers(api)[verb]
  if (!registration) throw new Error(`Missing Excalidraw handler: ${verb}`)
  if (typeof registration === 'function') return Promise.resolve(registration(payload))
  const input = registration.inputSchema.parse(payload)
  return Promise.resolve(registration.handler(input)).then((result) =>
    registration.resultSchema.parse(result)
  )
}

describe('Excalidraw bridge handlers', () => {
  it('converts and appends draw elements as an undoable update', async () => {
    const api = fakeApi([{ id: 'existing' }])
    const result = await run(api, 'draw', {
      elements: [
        { type: 'rectangle', x: 10, y: 20, text: 'Box' },
        { type: 'text', x: 40, y: 50, text: 'Hello' }
      ]
    })

    expect(result).toEqual({ ok: true, drawn: 2, replaced: false })
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
      })
    )
    expect(JSON.stringify(vi.mocked(api.updateScene).mock.calls[0])).toContain('"existing"')
    expect(api.scrollToContent).toHaveBeenCalledWith(expect.any(Array), { fitToContent: true })
  })

  it('replaces existing elements when requested', async () => {
    const api = fakeApi([{ id: 'existing' }])
    await run(api, 'draw', {
      elements: [{ type: 'ellipse', x: 0, y: 0 }],
      replace: true
    })

    expect(JSON.stringify(vi.mocked(api.updateScene).mock.calls[0])).toContain('"converted-0"')
    expect(JSON.stringify(vi.mocked(api.updateScene).mock.calls[0])).not.toContain('"existing"')
  })

  it('returns a compact, capped scene summary', async () => {
    const elements = Array.from({ length: 101 }, (_, index) => ({
      id: `${index}`,
      type: 'rectangle',
      x: 1.4,
      y: 2.6,
      width: 10.2,
      height: 20.8,
      ...(index === 0 ? { text: 'first' } : {})
    }))
    const api = fakeApi(elements)
    const result = (await run(api, 'read', {})) as {
      count: number
      truncated: boolean
      elements: unknown[]
      appState: unknown
    }

    expect(result.count).toBe(101)
    expect(result.truncated).toBe(true)
    expect(result.elements).toHaveLength(100)
    expect(result.elements[0]).toEqual({
      id: '0',
      type: 'rectangle',
      x: 1,
      y: 3,
      width: 10,
      height: 21,
      text: 'first'
    })
    expect(result.appState).toEqual({ scrollX: 10, scrollY: -6, zoom: 0.75, theme: 'light' })
  })

  it('clears the scene as an undoable update', async () => {
    const api = fakeApi([{ id: 'existing' }])
    await expect(run(api, 'clear', {})).resolves.toEqual({ ok: true })
    expect(api.updateScene).toHaveBeenCalledWith({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
  })
})
