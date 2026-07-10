import { describe, expect, it } from 'vitest'
import { buildToolNameMap, toolInvocationsToMessages } from '../src/runtime/tool-calling.js'
import type { PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import type { ToolInvocation } from '@tinytinkerer/app-core'

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

// Inference token fix: an image-producing tool's `media` array carries a full
// base64 `dataUrl` per item — display-only, and never something the model
// should see. `toolInvocationsToMessages` (via `serializeToolResult`) must
// substitute a compact `{ mediaRef, description, width, height, mimeType }`
// handle for each item instead, so the base64 never reaches the LLM message
// history (the seam that was bloating every DECIDE/SYNTHESIZE request).
describe('toolInvocationsToMessages — media stripping (inference token fix)', () => {
  const toWire = (toolId: string) => toolId

  it('replaces a media item dataUrl with a mediaRef + description, keeping width/height/mimeType', () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(500)}`
    const invocation: ToolInvocation = {
      callId: 'call-1',
      toolId: 'render_chart',
      input: {},
      outcome: {
        ok: true,
        output: {
          summary: 'chart rendered',
          media: [
            {
              kind: 'image',
              dataUrl,
              mimeType: 'image/png',
              width: 640,
              height: 480,
              description: 'A bar chart of Q1 sales'
            }
          ]
        }
      }
    }

    const messages = toolInvocationsToMessages([invocation], toWire)
    const toolMessage = messages.find((m) => m.role === 'tool')
    const content = toolMessage?.content as string

    // The base64 payload must never reach the model.
    expect(content).not.toContain('data:image')
    expect(content).not.toContain('dataUrl')

    // The compact handle + description + dimensions must be present instead.
    expect(content).toContain('media:call-1#0')
    expect(content).toContain('A bar chart of Q1 sales')
    const parsed = JSON.parse(content) as {
      summary: string
      media: Array<{
        mediaRef: string
        description: string
        width: number
        height: number
        mimeType: string
      }>
    }
    expect(parsed.summary).toBe('chart rendered')
    expect(parsed.media).toEqual([
      {
        mediaRef: 'media:call-1#0',
        description: 'A bar chart of Q1 sales',
        width: 640,
        height: 480,
        mimeType: 'image/png'
      }
    ])
  })

  it('serializes a media-less tool output unchanged (structural parity with before)', () => {
    const invocation: ToolInvocation = {
      callId: 'call-2',
      toolId: 'lookup',
      input: { q: 'weather' },
      outcome: { ok: true, output: { result: 'sunny', temp: 72 } }
    }

    const messages = toolInvocationsToMessages([invocation], toWire)
    const toolMessage = messages.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe(JSON.stringify({ result: 'sunny', temp: 72 }))
  })

  it('still returns "Error: ..." for a failed outcome', () => {
    const invocation: ToolInvocation = {
      callId: 'call-3',
      toolId: 'lookup',
      input: {},
      outcome: { ok: false, error: 'timed out' }
    }

    const messages = toolInvocationsToMessages([invocation], toWire)
    const toolMessage = messages.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe('Error: timed out')
  })
})
