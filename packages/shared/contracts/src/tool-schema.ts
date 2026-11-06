import * as z from 'zod'

// Canonical Zod → JSON Schema path for tool descriptors (issue #287). A tool's
// Zod `schema` (the runtime contract `ToolRegistry.run` parses against) is the
// SINGLE SOURCE OF TRUTH: the planner-facing JSON Schema the model sees is
// GENERATED from it here, never hand-maintained alongside it. This kills the class
// of bug where a hand-written descriptor drifts from the Zod schema the runtime
// actually enforces (e.g. a missing enum or bound — see the read_dom descriptor
// that predates this).
//
// We use zod 4's native `z.toJSONSchema` (already in the tree — no new dependency):
// it emits a real JSON Schema object (`type`/`properties`/`required`/`enum`/
// `items`/`anyOf`/bounds), which is exactly what native tool calling forwards as
// `function.parameters` and what a provider needs for schema enforcement.

// JSON Schema is an open-ended object shape; callers treat it opaquely.
export type JsonSchemaObject = Record<string, unknown>

// Drop the `$schema` dialect marker zod stamps on the root. Providers reading a
// tool's `parameters` (or a nested property schema) don't want it, and it only
// adds noise to the prompt-visible schema.
const stripSchemaDialect = (schema: JsonSchemaObject): JsonSchemaObject => {
  const copy = { ...schema }
  delete copy.$schema
  return copy
}

// Since zod 4.6, a ROOT schema carrying `.meta({ id })` (the contracts name their
// schemas for OpenAPI components, e.g. `SearchRequest`) is emitted as
// `{ $ref: '#/$defs/<id>', $defs: { <id>: {...} } }` instead of inline. Providers
// need the root itself to be the object (`function.parameters`, strict
// `response_format`), so inline the referenced definition back onto the root.
// Any other `$defs` are kept; the root's own entry is kept too if something
// still references it (a recursive schema).
const inlineRootRef = (schema: JsonSchemaObject): JsonSchemaObject => {
  const { $ref, $defs, ...rest } = schema
  if (typeof $ref !== 'string' || !$ref.startsWith('#/$defs/')) return schema
  const defs = { ...($defs as Record<string, JsonSchemaObject> | undefined) }
  const name = $ref.slice('#/$defs/'.length)
  const target = defs[name]
  if (!target) return schema
  if (!JSON.stringify(target).includes(JSON.stringify($ref))) delete defs[name]
  return {
    ...rest,
    ...target,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {})
  }
}

const normalizeJsonSchema = (schema: JsonSchemaObject): JsonSchemaObject =>
  inlineRootRef(stripSchemaDialect(schema))

// Faithful JSON Schema for a tool's INPUT, generated from its Zod schema.
//
// - `io: 'input'` — describe what the model must SEND (pre-parse shape), so
//   defaults/transforms don't leak the post-parse shape into the planner view.
// - `target: 'draft-2020-12'` — the dialect native OpenAI-compatible tool calling
//   expects.
// - Faithfulness over provider-strict friendliness (issue #287 decision): unions
//   render as `anyOf`, optionals stay out of `required`. This mirrors the runtime
//   contract exactly; strict-mode shaping is a separate concern handled only where
//   a provider demands it (see toStrictResponseJsonSchema).
//
// Object-root invariant: the result is forwarded verbatim as a tool's
// `function.parameters`, which OpenAI/ChatGPT-compatible providers require to have
// an object root. A schema whose ROOT is a union/array/primitive — e.g. a
// top-level `z.discriminatedUnion(...)` (renders as `anyOf`) — is rejected at call
// time with an opaque "Invalid schema for function '<tool>'" error. We fail fast
// here instead, where the descriptor is built, with an actionable message; nest a
// top-level union/array inside a `z.object({ ... })` to fix it. (A union nested in
// a property is fine and stays faithful — only the root must be an object.)
export const toolInputJsonSchema = (schema: z.ZodType): JsonSchemaObject => {
  const json = normalizeJsonSchema(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }))
  if (json.type !== 'object')
    throw new Error(
      `tool input schema must have an object root for function.parameters, got ` +
        `${JSON.stringify(json.type ?? (json.anyOf ? 'anyOf/union' : Object.keys(json)))}; ` +
        `wrap a top-level union/array in a z.object({ ... })`
    )
  return json
}

// Strict JSON Schema for a model RESPONSE payload (OpenAI `response_format`
// `json_schema` with `strict: true`), generated from a Zod schema. Strict mode
// requires every object to be closed (`additionalProperties: false`) and lists all
// declared properties as `required`; zod's default (`io: 'output'`) already emits
// `additionalProperties: false` for `z.object`, and the caller's schema must avoid
// open records and `.optional()` (use `.nullable()` instead) so the generated
// schema is strict-valid. Unlike a tool's input descriptor this is the strict path:
// the provider is asked to ENFORCE the shape at generation, with a Zod re-parse as
// the authoritative backstop. See executionPlanWireSchema for the planner's use.
export const toStrictResponseJsonSchema = (schema: z.ZodType): JsonSchemaObject =>
  normalizeJsonSchema(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }))
