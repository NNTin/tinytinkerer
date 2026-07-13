import { describe, expect, it, vi } from 'vitest'
import type { CanvasController } from '../src/controller-handle'
import { createCanvasAppTools } from '../src/tools'

const handle = (request = vi.fn().mockResolvedValue({ ok: true })) =>
  ({
    request
  }) as { request(method: keyof CanvasController, input?: unknown): Promise<unknown> }

describe('canvas app tools', () => {
  it('exposes only the schema-validated canvas verbs', () => {
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
      'transform',
      'bind',
      'audit',
      'snap',
      'place',
      'arrange',
      'survey',
      'preset',
      'icon',
      'preview',
      'thumbnail',
      'pick'
    ])
    expect(
      tools.find((tool) => tool.id === 'draw')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
    expect(tools.find((tool) => tool.id === 'read')?.schema.safeParse({}).success).toBe(false)
    // `fields` is optional on read, both omitted (full records) and provided (a
    // lean projection).
    expect(
      tools.find((tool) => tool.id === 'read')?.schema.safeParse({ elementIds: ['a'] }).success
    ).toBe(true)
    expect(
      tools
        .find((tool) => tool.id === 'read')
        ?.schema.safeParse({
          elementIds: ['a'],
          fields: ['x', 'y']
        }).success
    ).toBe(true)
    // structural verbs consume the shared schemas, e.g. transform requires versioned edits
    expect(
      tools.find((tool) => tool.id === 'transform')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
    expect(
      tools.find((tool) => tool.id === 'align')?.schema.safeParse({ axis: 'x', position: 'start' })
        .success
    ).toBe(true)
    // the binding verbs consume the shared schemas too
    expect(
      tools
        .find((tool) => tool.id === 'bind')
        ?.schema.safeParse({
          connector: { id: 'link', expectedVersion: 1 },
          expectedSceneVersion: 2
        }).success
    ).toBe(false)
    expect(tools.find((tool) => tool.id === 'audit')?.schema.safeParse({}).success).toBe(true)
    // the layout verbs consume the shared schemas too
    expect(tools.find((tool) => tool.id === 'snap')?.schema.safeParse({}).success).toBe(true)
    expect(tools.find((tool) => tool.id === 'survey')?.schema.safeParse({}).success).toBe(true)
    expect(
      tools
        .find((tool) => tool.id === 'place')
        ?.schema.safeParse({
          elements: [{ id: 'a', expectedVersion: 1 }],
          anchor: { elementId: 'box' },
          relation: 'below',
          expectedSceneVersion: 2
        }).success
    ).toBe(true)
    expect(
      tools.find((tool) => tool.id === 'arrange')?.schema.safeParse({ elements: [] }).success
    ).toBe(false)
    // the safer-workflow verbs consume the shared schemas too
    expect(
      tools
        .find((tool) => tool.id === 'preview')
        ?.schema.safeParse({
          verb: 'edit',
          input: { edits: [{ id: 'a', expectedVersion: 1, changes: { x: 10 } }] }
        }).success
    ).toBe(true)
    expect(
      tools.find((tool) => tool.id === 'preview')?.schema.safeParse({ verb: 'read', input: {} })
        .success
    ).toBe(false)
    expect(
      tools.find((tool) => tool.id === 'preview')?.schema.parse({ verb: 'clear', input: {} })
    ).toMatchObject({ render: true, maxDimension: 512 })
    expect(tools.find((tool) => tool.id === 'pick')?.schema.parse({})).toEqual({
      mode: 'current',
      timeoutSeconds: 60,
      detail: 'standard'
    })
    // `fields` is optional on pick too.
    expect(
      tools.find((tool) => tool.id === 'pick')?.schema.parse({ fields: ['x', 'y'] })
    ).toMatchObject({ fields: ['x', 'y'] })
  })

  it('marks only pick as awaiting human input', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const tools = createCanvasAppTools(handle(request))
    const pick = tools.find((tool) => tool.id === 'pick')
    expect(pick?.awaitsHumanInput).toBe(true)
    expect(tools.find((tool) => tool.id === 'preview')?.awaitsHumanInput).toBeUndefined()
    expect(tools.find((tool) => tool.id === 'thumbnail')?.awaitsHumanInput).toBeUndefined()

    const parsed = pick?.schema.parse({ mode: 'interactive' })
    await expect(pick?.execute(parsed)).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('pick', parsed)
  })

  it('forwards validated tool input to the controller handle', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, drawn: 1 })
    const draw = createCanvasAppTools(handle(request)).find((tool) => tool.id === 'draw')
    const input = { elements: [{ type: 'rectangle' as const, x: 0, y: 0 }] }
    const parsed = draw?.schema.parse(input)

    await expect(draw?.execute(parsed)).resolves.toEqual({ ok: true, drawn: 1 })
    expect(request).toHaveBeenCalledWith('draw', { ...input, connectors: [] })
  })
})
