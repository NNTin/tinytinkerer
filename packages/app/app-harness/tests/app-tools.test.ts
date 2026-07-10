import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { appToolsFromVerbs } from '../src/app-tools'
import type { AppBridgeHandle } from '../src/bridge-handle'

const fakeHandle = (request = vi.fn().mockResolvedValue('done')): AppBridgeHandle => ({
  setClient: vi.fn(),
  setUnavailable: vi.fn(),
  getStatus: () => 'ready',
  request
})

describe('appToolsFromVerbs', () => {
  it('builds one Tool per verb carrying the declared id, description, and schema', () => {
    const drawSchema = z.object({ elements: z.array(z.unknown()) })
    const handle = fakeHandle()
    const tools = appToolsFromVerbs({
      handle,
      verbs: {
        draw: { description: 'Draw elements', schema: drawSchema },
        clear: { description: 'Clear the canvas', schema: z.object({}) }
      }
    })

    expect(tools.map((t) => t.id)).toEqual(['draw', 'clear'])
    const draw = tools.find((t) => t.id === 'draw')
    expect(draw?.description).toBe('Draw elements')
    expect(draw?.schema).toBe(drawSchema)
  })

  it('routes execute() through the bridge handle with the verb and input', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const handle = fakeHandle(request)
    const [draw] = appToolsFromVerbs({
      handle,
      verbs: { draw: { description: 'Draw', schema: z.object({ n: z.number() }) } }
    })

    await expect(draw?.execute({ n: 3 })).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('draw', { n: 3 })
  })

  it('leaves awaitsHumanInput and the request timeout absent by default', () => {
    const handle = fakeHandle()
    const [draw] = appToolsFromVerbs({
      handle,
      verbs: { draw: { description: 'Draw', schema: z.object({}) } }
    })

    expect(draw?.awaitsHumanInput).toBeUndefined()
  })

  it('forwards awaitsHumanInput onto the Tool for a human-in-the-loop verb', () => {
    const handle = fakeHandle()
    const [pick] = appToolsFromVerbs({
      handle,
      verbs: {
        pick: { description: 'Pick', schema: z.object({}), awaitsHumanInput: true }
      }
    })

    expect(pick?.awaitsHumanInput).toBe(true)
  })

  it('forwards requestTimeoutMs into the bridge request when declared', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const handle = fakeHandle(request)
    const [pick] = appToolsFromVerbs({
      handle,
      verbs: {
        pick: {
          description: 'Pick',
          schema: z.object({}),
          awaitsHumanInput: true,
          requestTimeoutMs: 130_000
        }
      }
    })

    await expect(pick?.execute({})).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('pick', {}, { timeoutMs: 130_000 })
  })
})
