import { describe, expect, it, vi } from 'vitest'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { createCanvasAppTools } from './canvas-runtime'
import { resolveExcalidrawAppSrc } from './canvas-page'

const handle = (request = vi.fn().mockResolvedValue({ ok: true })): AppBridgeHandle => ({
  setClient: vi.fn(),
  setUnavailable: vi.fn(),
  getStatus: () => 'ready',
  request
})

describe('canvas app tools', () => {
  it('resolves the iframe as a sibling of the canvas deployment path', () => {
    expect(resolveExcalidrawAppSrc('/canvas/')).toBe('/excalidraw-app/')
    expect(resolveExcalidrawAppSrc('/tinytinkerer/canvas/')).toBe('/tinytinkerer/excalidraw-app/')
  })

  it('exposes only the protocol-backed draw, read, and clear verbs', () => {
    const tools = createCanvasAppTools(handle())
    expect(tools.map((tool) => tool.id)).toEqual(['draw', 'read', 'clear'])
    expect(
      tools.find((tool) => tool.id === 'draw')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
  })

  it('forwards validated tool input to the bridge handle', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, drawn: 1 })
    const draw = createCanvasAppTools(handle(request)).find((tool) => tool.id === 'draw')
    const input = { elements: [{ type: 'rectangle' as const, x: 0, y: 0 }] }

    await expect(draw?.execute(draw.schema.parse(input))).resolves.toEqual({ ok: true, drawn: 1 })
    expect(request).toHaveBeenCalledWith('draw', input)
  })
})
