import {
  searchRequestSchema,
  searchResponseSchema,
  toolInputJsonSchema,
  type PluginHost
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { webSearchPlugin, webSearchPluginManifest } from '../src/index'

// Drift guard (issue #287): the planner descriptor and the runtime tool must share
// ONE Zod schema. These tests FAIL if the manifest descriptor diverges from the
// schema the tool actually validates against, or if the generated planner JSON
// Schema is not strict-acceptable.

const descriptor = webSearchPluginManifest.toolDescriptors?.[0]
const host: PluginHost = { capture: vi.fn(), edgeFetch: vi.fn() }
const [tool] = webSearchPlugin().createTools?.(host) ?? []

describe('web-search canonical schema', () => {
  it('descriptor schema is the SAME schema the runtime tool validates against', () => {
    expect(descriptor?.schema).toBe(searchRequestSchema)
    expect(tool?.schema).toBe(searchRequestSchema)
    expect(descriptor?.schema).toBe(tool?.schema)
  })

  it('generates a strict-acceptable JSON Schema with the required field and bounds', () => {
    const json = toolInputJsonSchema(descriptor!.schema)
    expect(json.type).toBe('object')
    expect(json).toHaveProperty('properties')
    expect(json.required).toEqual(['query'])
    const props = json.properties as Record<string, Record<string, unknown>>
    expect(props.query).toMatchObject({ type: 'string', minLength: 2, maxLength: 500 })
    expect(props.maxResults).toMatchObject({ type: 'integer', maximum: 10 })
  })

  it('declares an output schema the runtime can validate', () => {
    expect(tool?.outputSchema).toBe(searchResponseSchema)
  })
})
