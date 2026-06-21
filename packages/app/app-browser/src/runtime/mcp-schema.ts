import { z } from 'zod'

// Minimal JSON Schema → Zod compiler that gives an MCP tool's discovered input
// contract a LOCAL TRIAGE check at execution (previously every MCP tool used a
// permissive `z.record(unknown)`, so a hallucinated argument sailed through to the
// remote server as an opaque error). This is a partial check, NOT a full
// JSON-Schema validator and NOT a replacement for the remote server's own
// validation — callers must keep their remote/transport error handling regardless.
//
// ENFORCED: required-ness (`required`), primitive `type`s (string / number /
//   integer / boolean), `enum` membership, and nested object/array SHAPE
//   (`properties`, `items`).
// NOT MODELED (passes through silently → `z.unknown()`): numeric/string refinements
//   (`minimum`/`maximum`/`pattern`/`format`/`minLength`…), composition (`$ref`/
//   `definitions`, `oneOf`/`anyOf`/`allOf`), and `const`.
//
// It is deliberately FAIL-OPEN: any unmodeled construct becomes `z.unknown()` (and a
// non-object top-level schema falls back to a permissive record), so a
// valid-but-exotic tool call is never rejected. We validate what we can describe and
// get out of the way otherwise — the gap is invisible at the call site, so do not
// over-trust this as "the input is validated."

type JsonSchema = Record<string, unknown>

const isJsonSchema = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A permissive record — the fallback whenever a schema cannot be modeled.
const permissiveRecord = (): z.ZodType<Record<string, unknown>> => z.record(z.string(), z.unknown())

const nodeToZod = (schema: unknown): z.ZodTypeAny => {
  if (!isJsonSchema(schema)) {
    return z.unknown()
  }

  // `enum`: accept exactly one of the listed values. Validated by membership so we
  // don't have to model heterogeneous literal unions — fail-open on shape, strict
  // on value.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const allowed = schema.enum
    return z.unknown().refine((value) => allowed.includes(value), {
      message: 'Value is not one of the allowed enum options'
    })
  }

  switch (schema.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array('items' in schema ? nodeToZod(schema.items) : z.unknown())
    case 'object':
      return objectToZod(schema)
    default:
      // Missing or unmodeled `type` → fail open.
      return z.unknown()
  }
}

const objectToZod = (schema: JsonSchema): z.ZodTypeAny => {
  const properties = isJsonSchema(schema.properties) ? schema.properties : undefined
  if (!properties) {
    // An object with no declared properties accepts any record.
    return permissiveRecord()
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : []
  )

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    const zodProp = nodeToZod(propSchema)
    shape[key] = required.has(key) ? zodProp : zodProp.optional()
  }

  // `.passthrough()`: keep undeclared keys rather than stripping them — the remote
  // server may legitimately accept extras, and we are validating the declared
  // fields, not exhaustiveness.
  return z.object(shape).passthrough()
}

// Build a Zod input validator for an MCP tool from its discovered JSON Schema.
// Always resolves to something that parses a `Record<string, unknown>`: an object
// validator when the schema is an object schema, otherwise a permissive record
// (so execution never breaks on an unexpected top-level shape).
export const mcpInputSchemaToZod = (
  inputSchema: Record<string, unknown> | undefined
): z.ZodType<Record<string, unknown>> => {
  if (!isJsonSchema(inputSchema)) {
    return permissiveRecord()
  }
  // Only object-typed schemas (the MCP norm) get field validation; a non-object or
  // typeless top-level schema stays permissive.
  if (inputSchema.type !== undefined && inputSchema.type !== 'object') {
    return permissiveRecord()
  }
  return objectToZod(inputSchema) as z.ZodType<Record<string, unknown>>
}
