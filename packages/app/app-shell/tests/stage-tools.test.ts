import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
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
})
