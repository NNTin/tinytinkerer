import { toolInputJsonSchema, type PluginHost } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { browserStatePlugin, browserStatePluginManifest, readDomInputSchema } from '../src/index'

// Drift guard (issue #287): the planner descriptor and the runtime tool share ONE
// Zod schema. The hand-written descriptor this replaced had DRIFTED — it dropped
// the `region`/`include` enums and the integer bounds. These tests fail if that
// regresses, since the JSON Schema is now generated from the single source.

const descriptor = browserStatePluginManifest.toolDescriptors?.[0]
const host: PluginHost = { capture: vi.fn(), readDom: vi.fn() }
const [tool] = browserStatePlugin().createTools?.(host) ?? []

describe('read_dom canonical schema', () => {
  it('descriptor schema is the SAME schema the runtime tool validates against', () => {
    expect(descriptor?.schema).toBe(readDomInputSchema)
    expect(tool?.schema).toBe(readDomInputSchema)
    expect(descriptor?.schema).toBe(tool?.schema)
  })

  it('surfaces the region/include enums and integer bounds the old descriptor dropped', () => {
    const json = toolInputJsonSchema(descriptor!.schema)
    expect(json.type).toBe('object')
    const props = json.properties as Record<string, Record<string, unknown>>

    // The drift fix: `region` is an enum, not a bare string.
    expect(props.region).toMatchObject({ type: 'string', enum: ['top', 'bottom'] })
    // `include` is an array whose items are an enum.
    expect(props.include).toMatchObject({
      type: 'array',
      items: { enum: ['html', 'text', 'attributes', 'rect'] }
    })
    // Integer bounds reach the model now.
    expect(props.depth).toMatchObject({ type: 'integer', minimum: 0, maximum: 8 })
    expect(props.maxNodes).toMatchObject({ type: 'integer', maximum: 100 })
    // All read_dom fields are optional.
    expect(json.required ?? []).toEqual([])
  })
})
