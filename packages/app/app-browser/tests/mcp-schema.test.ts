import { describe, expect, it } from 'vitest'
import { mcpInputSchemaToZod } from '../src/runtime/mcp-schema'

describe('mcpInputSchemaToZod', () => {
  const weatherSchema = {
    type: 'object',
    properties: {
      location: { type: 'string' },
      units: { type: 'string', enum: ['metric', 'imperial'] },
      days: { type: 'integer' }
    },
    required: ['location']
  }

  it('accepts input that satisfies the declared schema', () => {
    const schema = mcpInputSchemaToZod(weatherSchema)
    expect(schema.safeParse({ location: 'Berlin', units: 'metric', days: 3 }).success).toBe(true)
    // Optional fields may be omitted.
    expect(schema.safeParse({ location: 'Berlin' }).success).toBe(true)
  })

  it('rejects a missing required field', () => {
    const schema = mcpInputSchemaToZod(weatherSchema)
    expect(schema.safeParse({ units: 'metric' }).success).toBe(false)
  })

  it('rejects a declared field of the wrong type', () => {
    const schema = mcpInputSchemaToZod(weatherSchema)
    expect(schema.safeParse({ location: 42 }).success).toBe(false)
    // integer rejects a float.
    expect(schema.safeParse({ location: 'Berlin', days: 1.5 }).success).toBe(false)
  })

  it('enforces enum membership', () => {
    const schema = mcpInputSchemaToZod(weatherSchema)
    expect(schema.safeParse({ location: 'Berlin', units: 'kelvin' }).success).toBe(false)
    expect(schema.safeParse({ location: 'Berlin', units: 'imperial' }).success).toBe(true)
  })

  it('passes undeclared keys through rather than stripping them', () => {
    const schema = mcpInputSchemaToZod(weatherSchema)
    const parsed = schema.safeParse({ location: 'Berlin', extra: 'keep-me' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.extra).toBe('keep-me')
  })

  it('validates nested objects and arrays', () => {
    const schema = mcpInputSchemaToZod({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        filter: {
          type: 'object',
          properties: { min: { type: 'number' } },
          required: ['min']
        }
      },
      required: ['tags']
    })
    expect(schema.safeParse({ tags: ['a', 'b'], filter: { min: 1 } }).success).toBe(true)
    expect(schema.safeParse({ tags: [1, 2] }).success).toBe(false)
    expect(schema.safeParse({ tags: ['a'], filter: {} }).success).toBe(false)
  })

  it('fails open for schemas it cannot model', () => {
    // No schema at all → permissive.
    expect(mcpInputSchemaToZod(undefined).safeParse({ anything: true }).success).toBe(true)
    // A non-object top-level type → permissive record (the MCP norm is object).
    expect(mcpInputSchemaToZod({ type: 'string' }).safeParse({ whatever: 1 }).success).toBe(true)
    // An object schema with no declared properties → any record.
    expect(mcpInputSchemaToZod({ type: 'object' }).safeParse({ a: 1, b: 2 }).success).toBe(true)
    // A declared property with an unmodeled type → that field is not constrained.
    const exotic = mcpInputSchemaToZod({
      type: 'object',
      properties: { weird: { anyOf: [{ type: 'string' }, { type: 'number' }] } }
    })
    expect(exotic.safeParse({ weird: 'a' }).success).toBe(true)
    expect(exotic.safeParse({ weird: 5 }).success).toBe(true)
  })
})
