import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  executionPlanFromWire,
  executionPlanSchema,
  executionPlanWireSchema,
  toStrictResponseJsonSchema,
  toolInputJsonSchema,
  type ExecutionPlanWire
} from '../src/index'

// Canonical Zod → JSON Schema path (issue #287). These guard the SHARED mechanism
// every tool descriptor and the planner's structured output rely on: if it ever
// stops emitting strict, faithful JSON Schema, every tool drifts at once.

describe('toolInputJsonSchema', () => {
  it('emits a JSON Schema object with type/properties/required and drops the $schema dialect', () => {
    const schema = z.object({
      query: z.string().min(2).max(500).describe('the query'),
      maxResults: z.number().int().min(1).max(10).optional()
    })

    const json = toolInputJsonSchema(schema)

    expect(json).not.toHaveProperty('$schema')
    expect(json.type).toBe('object')
    expect(json.properties).toMatchObject({
      query: { type: 'string', minLength: 2, maxLength: 500, description: 'the query' },
      maxResults: { type: 'integer', minimum: 1, maximum: 10 }
    })
    // A required field is listed; an optional one is not.
    expect(json.required).toEqual(['query'])
  })

  it('renders enums and arrays-of-enums faithfully', () => {
    const json = toolInputJsonSchema(
      z.object({
        category: z.enum(['bug', 'idea']),
        include: z.array(z.enum(['html', 'text'])).optional()
      })
    )
    const props = json.properties as Record<string, Record<string, unknown>>
    expect(props.category).toMatchObject({ type: 'string', enum: ['bug', 'idea'] })
    expect(props.include).toMatchObject({ type: 'array', items: { enum: ['html', 'text'] } })
  })

  it('renders a union as anyOf (faithful, not flattened — issue #287 decision)', () => {
    const json = toolInputJsonSchema(
      z.object({ input: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]) })
    )
    const props = json.properties as Record<string, Record<string, unknown>>
    expect(props.input).toHaveProperty('anyOf')
    expect(Array.isArray(props.input?.anyOf)).toBe(true)
  })
})

describe('toStrictResponseJsonSchema', () => {
  it('closes every object (additionalProperties:false) and lists every key as required', () => {
    const json = toStrictResponseJsonSchema(executionPlanWireSchema)
    expect(json.additionalProperties).toBe(false)
    expect(json.required).toEqual(['complexity', 'steps'])

    const stepItems = (
      (json.properties as Record<string, Record<string, unknown>>).steps as Record<string, unknown>
    ).items as Record<string, unknown>
    expect(stepItems.additionalProperties).toBe(false)
    // toolCall is REQUIRED (nullable), not optional — the strict-mode shape.
    expect(stepItems.required).toEqual(['id', 'summary', 'toolCall'])
  })
})

describe('executionPlanWireSchema + executionPlanFromWire', () => {
  it('decodes a string-encoded tool input into the runtime ExecutionPlan', () => {
    const wire: ExecutionPlanWire = {
      complexity: 'medium',
      steps: [
        { id: 'understand', summary: 'parse', toolCall: null },
        {
          id: 'search',
          summary: 'search',
          toolCall: { toolId: 'web-search', input: '{"query":"hi"}' }
        }
      ]
    }

    const plan = executionPlanSchema.parse(executionPlanFromWire(wire))

    expect(plan.steps[0]).toEqual({ id: 'understand', summary: 'parse' })
    expect(plan.steps[1]?.toolCall).toEqual({ toolId: 'web-search', input: { query: 'hi' } })
  })

  it('falls back to empty input when the encoded arguments are not valid JSON', () => {
    const wire: ExecutionPlanWire = {
      complexity: 'low',
      steps: [{ id: 's', summary: 's', toolCall: { toolId: 't', input: 'not json' } }]
    }
    const plan = executionPlanFromWire(wire)
    expect(plan.steps[0]?.toolCall).toEqual({ toolId: 't', input: {} })
  })

  it('rejects a wire plan whose step is missing the required (nullable) toolCall', () => {
    // The strict wire shape requires `toolCall` to be present (possibly null); a
    // step that omits it is invalid — this is what makes the structured-output
    // contract enforceable rather than best-effort.
    expect(() =>
      executionPlanWireSchema.parse({
        complexity: 'low',
        steps: [{ id: 's', summary: 's' }]
      })
    ).toThrow()
  })
})
