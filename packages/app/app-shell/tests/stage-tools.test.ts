import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createStageControllerHandle } from '../src/stage-controller'
import { createStageTools } from '../src/stage-tools'

describe('createStageTools', () => {
  it('maps stage methods to model tools and forwards validated input', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const tools = createStageTools({
      handle: { request },
      methods: {
        inspect: {
          description: 'Inspect the stage.',
          schema: z.object({ detail: z.string() }),
          awaitsHumanInput: true
        }
      }
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      id: 'inspect',
      description: 'Inspect the stage.',
      awaitsHumanInput: true
    })
    await expect(tools[0]?.execute({ detail: 'full' })).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('inspect', { detail: 'full' })
  })

  it('passes outputSchema through, so the runtime validates the result (#518 F7)', () => {
    const outputSchema = z.object({ ok: z.boolean() })
    const [withOutput, without] = createStageTools({
      handle: { request: vi.fn() },
      methods: {
        read: { description: 'Read.', schema: z.object({}), outputSchema },
        write: { description: 'Write.', schema: z.object({}) }
      }
    })
    expect(withOutput?.outputSchema).toBe(outputSchema)
    expect(without).not.toHaveProperty('outputSchema')
  })

  it('checks the method table against a controller type (#518 F7)', async () => {
    type Editor = {
      getState: (input: unknown) => Promise<unknown>
      setParameters: (input: unknown) => Promise<unknown>
      label: string
    }
    const handle = createStageControllerHandle<Editor>('Editor is not mounted')
    const definition = { description: 'x', schema: z.object({}) }

    const tools = createStageTools({
      handle,
      methods: { getState: definition, setParameters: definition }
    })
    expect(tools.map((tool) => tool.id)).toEqual(['getState', 'setParameters'])
    await expect(tools[0]?.execute({})).rejects.toThrow('Editor is not mounted')

    // An explicit controller type demands every method, and only methods.
    createStageTools<Editor>({
      handle,
      // @ts-expect-error -- setParameters is missing
      methods: { getState: definition }
    })
    createStageTools<Editor>({
      handle,
      // @ts-expect-error -- `label` is not a method
      methods: { getState: definition, setParameters: definition, label: definition }
    })
    createStageTools({
      handle,
      // @ts-expect-error -- not a method of Editor
      methods: { getState: definition, setParameters: definition, typo: definition }
    })
  })
})
