import { describe, expect, it, vi } from 'vitest'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { createCanvasAppTools } from './canvas-runtime'

const handle = (request = vi.fn().mockResolvedValue({ ok: true })): AppBridgeHandle => ({
  setClient: vi.fn(),
  setUnavailable: vi.fn(),
  getStatus: () => 'ready',
  request
})

describe('canvas app tools', () => {
  it('exposes only the protocol-backed Excalidraw verbs', () => {
    const tools = createCanvasAppTools(handle())
    expect(tools.map((tool) => tool.id)).toEqual([
      'draw',
      'search',
      'inspect',
      'read',
      'edit',
      'clear',
      'group',
      'duplicate',
      'delete',
      'align',
      'distribute',
      'stack',
      'order',
      'transform'
    ])
    expect(
      tools.find((tool) => tool.id === 'draw')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
    expect(tools.find((tool) => tool.id === 'read')?.schema.safeParse({}).success).toBe(false)
    // structural verbs consume the shared schemas, e.g. transform requires versioned edits
    expect(
      tools.find((tool) => tool.id === 'transform')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
    expect(
      tools.find((tool) => tool.id === 'align')?.schema.safeParse({ axis: 'x', position: 'start' })
        .success
    ).toBe(true)
  })

  it('forwards validated tool input to the bridge handle', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, drawn: 1 })
    const draw = createCanvasAppTools(handle(request)).find((tool) => tool.id === 'draw')
    const input = { elements: [{ type: 'rectangle' as const, x: 0, y: 0 }] }
    const parsed = draw?.schema.parse(input)

    await expect(draw?.execute(parsed)).resolves.toEqual({ ok: true, drawn: 1 })
    expect(request).toHaveBeenCalledWith('draw', { ...input, connectors: [] })
  })
})
