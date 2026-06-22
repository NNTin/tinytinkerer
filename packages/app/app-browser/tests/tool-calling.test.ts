import { describe, expect, it } from 'vitest'
import { buildToolNameMap } from '../src/runtime/tool-calling.js'
import type { PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'

// Native tool calling (issue #276): the wire `function.parameters` MUST be a real
// JSON Schema. The repo's built-in tools declare `inputSchema` as a bare
// properties-map shorthand; advertising that verbatim made the model fire tools
// with empty `{}` arguments (the `code: undefined` failures). buildToolNameMap
// normalizes the shorthand into `{ type: 'object', properties }` while passing a
// real JSON Schema (e.g. an MCP tool's) through untouched.
describe('buildToolNameMap — wire parameters (issue #276)', () => {
  it('wraps a bare properties-map shorthand in a JSON Schema envelope', () => {
    const tool: PlannerToolDescriptor = {
      id: 'run_javascript',
      description: 'Run JS.',
      inputSchema: {
        code: { type: 'string', description: 'JS source' },
        input: { type: 'object', description: 'optional' }
      }
    }

    const { definitions } = buildToolNameMap([tool])
    const parameters = definitions[0]?.function.parameters as Record<string, unknown>

    // The envelope the model needs to learn the call HAS named parameters.
    expect(parameters.type).toBe('object')
    expect(parameters.properties).toEqual({
      code: { type: 'string', description: 'JS source' },
      input: { type: 'object', description: 'optional' }
    })
    // The shorthand keys are NOT left at the top level (that was the bug shape).
    expect('code' in parameters).toBe(false)
  })

  it('passes a real JSON Schema (MCP-style) through untouched', () => {
    const schema = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
      additionalProperties: false
    }
    const tool: PlannerToolDescriptor = {
      id: 'mcp:srv:lookup',
      description: 'Look up.',
      inputSchema: schema
    }

    const { definitions } = buildToolNameMap([tool])
    expect(definitions[0]?.function.parameters).toEqual(schema)
  })

  it('wraps an empty shorthand (no params) as an empty object schema', () => {
    const tool: PlannerToolDescriptor = { id: 'ping', description: 'Ping.', inputSchema: {} }
    const { definitions } = buildToolNameMap([tool])
    expect(definitions[0]?.function.parameters).toEqual({ type: 'object', properties: {} })
  })
})
