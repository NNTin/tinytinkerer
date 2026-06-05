import JSON5 from 'json5'
import { parseWithTelemetry, type RequestTelemetryMetadata } from './request-telemetry'

// Find the first *balanced* JSON object/array in `text`, honouring string
// literals (both " and ' — JSON5 allows single quotes) and escapes, and return
// that substring; or `null` if no balanced value exists (e.g. the stream was
// truncated before the closing brace, or there is no JSON at all). This
// deliberately does NOT complete or repair unbalanced input: a truncated
// decision must surface and fall back, never be fabricated into a runnable action.
const extractBalancedJson = (text: string): string | null => {
  const objAt = text.indexOf('{')
  const arrAt = text.indexOf('[')
  const start = objAt === -1 ? arrAt : arrAt === -1 ? objAt : Math.min(objAt, arrAt)
  if (start === -1) {
    return null
  }

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString: '"' | "'" | null = null
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === inString) {
        inString = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
    } else if (ch === open) {
      depth += 1
    } else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null // never balanced -> truncated / incomplete
}

// Parse model output that is *supposed* to be a single JSON value but often
// arrives sloppy-but-complete: wrapped in prose, using single quotes, trailing
// commas, or unquoted keys. Strategy:
//   1. Strict `JSON.parse` (fast path for well-formed output).
//   2. Extract the first balanced object/array (drops a prose preamble / trailing
//      commentary) and parse it with JSON5 (tolerates single quotes, trailing
//      commas, unquoted keys).
// Note: JSON5's own comment support is intentionally NOT relied on here — the
// balanced-extraction scan in `extractBalancedJson` is string-aware but not
// comment-aware, so a `}`/`]` inside a `//` or `/* … */` region could prematurely
// terminate extraction. Models effectively never emit comments in a JSON answer,
// so we keep the scanner simple rather than parse comment syntax we don't need.
// Throws when neither works — i.e. there is no *complete* JSON value to recover
// (the stream was truncated, or it is pure prose). We never auto-close brackets
// or strings, so a truncated value is reported and falls back rather than being
// fabricated. (See .agent/skills/sentry-debugging/workflows/llm-decision-parse-error.md.)
export const parseRobustModelJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    // Not strict JSON — try lenient recovery of a complete embedded value below.
  }

  const candidate = extractBalancedJson(text)
  if (candidate === null) {
    throw new SyntaxError('No complete JSON value found in model output')
  }
  return JSON5.parse(candidate)
}

// Strip an optional ```json … ``` fence the model sometimes wraps its answer in.
export const stripModelJsonFences = (text: string): string =>
  text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

// Raised by `parseModelJsonWithTelemetry` when the model's free-form output
// cannot be turned into the expected structured value. `kind` distinguishes a
// failure to parse any complete JSON (`parse_error`) from valid JSON that did
// not match the schema (`schema_error`); the original error is preserved as
// `cause`. Callers use it to tell a *model-content* failure (recover or surface,
// per the call site's policy) apart from a transport/network failure.
export class ModelJsonError extends Error {
  override readonly name = 'ModelJsonError'
  readonly kind: 'parse_error' | 'schema_error'

  constructor(
    kind: 'parse_error' | 'schema_error',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.kind = kind
  }
}

// Minimal structural shape of a parser (e.g. a zod schema's `.parse`). Declared
// here so this leaf package never has to depend on zod.
export interface ModelJsonSchema<T> {
  parse: (value: unknown) => T
}

export interface ModelJsonMessages {
  /** Captured + thrown when the content has no recoverable complete JSON value. */
  parseError: string
  /** Captured + thrown when the parsed JSON does not match the schema. */
  schemaError: string
}

// The single, shared way to turn an LLM's free-form `content` string into a
// validated, structured value. It folds together the boilerplate that used to be
// copy-pasted at every model-output call site:
//   strip ```json fences → parseRobustModelJson → schema.parse → telemetry.
//
// Policy-free by design: it returns the parsed value or **throws** a
// `ModelJsonError` (wrapping the underlying parse/schema failure). Each caller
// owns its fallback — the ReAct decider recovers to `{ kind: 'final' }`, the
// planner surfaces the error to the run-error path. It "stays loud": every
// failure is still captured via `parseWithTelemetry` (no `accept`), because a
// truncated/non-conforming response is a real defect to investigate even when we
// recover for the user. (See .agent/skills/sentry-debugging/workflows/llm-decision-parse-error.md.)
export const parseModelJsonWithTelemetry = <T>(
  metadata: RequestTelemetryMetadata,
  text: string,
  schema: ModelJsonSchema<T>,
  messages: ModelJsonMessages,
  response?: Response
): T => {
  const stripped = stripModelJsonFences(text)

  let parsed: unknown
  try {
    // parseRobustModelJson tolerates sloppy-but-complete model output (prose
    // wrapping, single quotes, trailing commas) but never repairs a truncated
    // value — so genuine incompleteness still surfaces as a parse_error.
    parsed = parseWithTelemetry<unknown>(
      metadata,
      'parse_error',
      messages.parseError,
      () => parseRobustModelJson(stripped),
      response
    )
  } catch (error) {
    throw new ModelJsonError('parse_error', messages.parseError, { cause: error })
  }

  try {
    return parseWithTelemetry(
      metadata,
      'schema_error',
      messages.schemaError,
      () => schema.parse(parsed),
      response
    )
  } catch (error) {
    throw new ModelJsonError('schema_error', messages.schemaError, { cause: error })
  }
}
