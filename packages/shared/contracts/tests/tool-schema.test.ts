import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  executionPlanFromWire,
  executionPlanSchema,
  executionPlanWireSchema,
  planStepSchema,
  toStrictResponseJsonSchema,
  toolInputJsonSchema,
  type ExecutionPlanWire
} from '../src/index'

// Recursively assert a JSON Schema is OpenAI strict-mode valid: EVERY object node
// must close itself (`additionalProperties: false`) and list every declared
// property in `required`. Walks properties, array `items`, and `anyOf`/`allOf`/
// `oneOf` variants (a `.nullable()` field renders as `anyOf: [schema, {null}]`).
// This guards the invariant that was previously prose-only (arch review finding C):
// if a future edit adds `.optional()` or an open `z.record` to the wire schema, the
// generated schema stops being strict-valid and the provider rejects it at runtime
// — this test fails first.
const assertStrictValid = (node: unknown): void => {
  if (!node || typeof node !== 'object') return
  const schema = node as Record<string, unknown>
  const props = schema.properties as Record<string, unknown> | undefined
  if (props) {
    expect(
      schema.additionalProperties,
      `object not closed: ${JSON.stringify(schema).slice(0, 160)}`
    ).toBe(false)
    expect(new Set((schema.required as string[] | undefined) ?? [])).toEqual(
      new Set(Object.keys(props))
    )
    for (const child of Object.values(props)) assertStrictValid(child)
  }
  if (schema.items) assertStrictValid(schema.items)
  for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
    const variants = schema[key]
    if (Array.isArray(variants)) variants.forEach(assertStrictValid)
  }
}

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

  it('emits a fully strict-valid schema — every nested object closed + all keys required (finding C)', () => {
    // Not just the root: recurse through steps, the nullable toolCall, and its
    // nested objects. This is the guard the strict-mode invariant lacked before.
    assertStrictValid(toStrictResponseJsonSchema(executionPlanWireSchema))
  })
})

describe('wire/runtime plan schema alignment (finding D)', () => {
  it('the wire step exposes exactly the runtime step fields — only the toolCall encoding differs', () => {
    // executionPlanWireSchema/planStepWireSchema are DERIVED from the runtime
    // schemas via omit/extend, so a field added to planStepSchema flows into the
    // wire shape for free. This asserts that coupling holds: if a future edit
    // replaces the derivation with a hand-written object that forgets a field, the
    // key sets diverge and this fails — catching drift CI's types would not.
    const wire = toStrictResponseJsonSchema(executionPlanWireSchema)
    const wireStepItems = (
      (wire.properties as Record<string, Record<string, unknown>>).steps as Record<string, unknown>
    ).items as Record<string, unknown>
    const wireKeys = Object.keys(wireStepItems.properties as Record<string, unknown>)
    const runtimeKeys = Object.keys(
      toolInputJsonSchema(planStepSchema).properties as Record<string, unknown>
    )

    expect(new Set(wireKeys)).toEqual(new Set(runtimeKeys))
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
