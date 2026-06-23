import { feedbackInputSchema, toolInputJsonSchema, type PluginHost } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { feedbackPlugin, feedbackPluginManifest } from '../src/index'

// Drift guard (issue #287): the planner descriptor and the runtime tool share ONE
// Zod schema; the generated planner JSON Schema is strict-acceptable.

const descriptor = feedbackPluginManifest.toolDescriptors?.[0]
const host: PluginHost = { capture: vi.fn() }
const [tool] = feedbackPlugin().createTools?.(host) ?? []

describe('send_feedback canonical schema', () => {
  it('descriptor schema is the SAME schema the runtime tool validates against', () => {
    expect(descriptor?.schema).toBe(feedbackInputSchema)
    expect(tool?.schema).toBe(feedbackInputSchema)
    expect(descriptor?.schema).toBe(tool?.schema)
  })

  it('generates a JSON Schema with the category enum and both required fields', () => {
    const json = toolInputJsonSchema(descriptor!.schema)
    expect(json.type).toBe('object')
    expect(json.required).toEqual(['message', 'category'])
    const props = json.properties as Record<string, Record<string, unknown>>
    expect(props.category).toMatchObject({ type: 'string', enum: ['bug', 'idea'] })
    expect(props.message).toMatchObject({ type: 'string', minLength: 1, maxLength: 2000 })
  })
})
