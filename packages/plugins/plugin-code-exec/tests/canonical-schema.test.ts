import { toolInputJsonSchema, type PluginHost } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import { codeExecInputSchema, codeExecPlugin, codeExecPluginManifest } from '../src/index'

// Drift guard (issue #287): the planner descriptor and the runtime tool share ONE
// Zod schema; the generated planner JSON Schema is strict-acceptable.

const descriptor = codeExecPluginManifest.toolDescriptors?.[0]
const host: PluginHost = { capture: vi.fn(), executeSandboxedCode: vi.fn() }
const [tool] = codeExecPlugin().createTools?.(host) ?? []

describe('run_javascript canonical schema', () => {
  it('descriptor schema is the SAME schema the runtime tool validates against', () => {
    expect(descriptor?.schema).toBe(codeExecInputSchema)
    expect(tool?.schema).toBe(codeExecInputSchema)
    expect(descriptor?.schema).toBe(tool?.schema)
  })

  it('generates a JSON Schema requiring code, with an optional input union', () => {
    const json = toolInputJsonSchema(descriptor!.schema)
    expect(json.type).toBe('object')
    // `code` is required; `input` is optional (a union → anyOf).
    expect(json.required).toEqual(['code'])
    const props = json.properties as Record<string, Record<string, unknown>>
    expect(props.code).toMatchObject({ type: 'string', minLength: 1 })
    expect(props.input).toHaveProperty('anyOf')
  })
})
