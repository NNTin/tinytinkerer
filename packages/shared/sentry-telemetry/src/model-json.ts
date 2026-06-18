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
  text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

// True when `text` contains at least one JSON object/array opener (`{` or `[`).
// Mirrors the start-detection in `extractBalancedJson`: when this is false the
// model emitted no JSON value at all (pure prose — it declined to produce a
// structured answer), which is a *different* situation from a value that was
// present but truncated/malformed. Callers use this to tell a benign prose
// finish ("I now have enough information…") apart from a real defect. A bare
// JSON primitive without braces (e.g. `42`) is rare from a model asked for an
// object and is treated as no-decision prose here.
export const containsJsonValue = (text: string): boolean => text.includes('{') || text.includes('[')

// Raised by `parseModelJsonWithTelemetry` when the model's free-form output
// cannot be turned into the expected structured value. `kind` distinguishes:
//   - `no_json`      — the model emitted no JSON value at all (pure prose). Only
//                      produced when the caller opts in via `silentWhenNoJson`;
//                      it is a benign "the model finished in prose" outcome and
//                      is NOT captured as telemetry (see the option below).
//   - `parse_error`  — a JSON value was present but truncated/malformed (a real
//                      defect — captured / loud).
//   - `schema_error` — valid JSON that did not match the schema (loud).
// The original error is preserved as `cause`. Callers use it to tell a
// *model-content* failure (recover or surface, per the call site's policy) apart
// from a transport/network failure.
export class ModelJsonError extends Error {
  override readonly name = 'ModelJsonError'
  readonly kind: 'no_json' | 'parse_error' | 'schema_error'

  constructor(
    kind: 'no_json' | 'parse_error' | 'schema_error',
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

export interface ModelJsonOptions {
  /**
   * When `true`, a response that contains NO JSON value at all (pure prose, e.g.
   * "I now have enough information…") is treated as a benign, expected outcome
   * rather than a defect: it is surfaced as a `ModelJsonError` of kind `no_json`
   * WITHOUT capturing telemetry, so the caller can recover silently. A response
   * that *did* contain JSON but was truncated/malformed (`parse_error`), or valid
   * JSON of the wrong shape (`schema_error`), still stays loud (captured).
   *
   * Default `false` — every failure is captured. Use it only at a call site that
   * may legitimately finish in prose (the ReAct decider, which recovers to
   * `{ kind: 'final' }`). The planner must leave it off: it has no safe prose
   * fallback, so a planner answering in prose is a real defect to surface.
   * (Distinguishes the benign prose-finish from the lossy truncation case;
   * see .agent/skills/sentry-debugging/workflows/llm-decision-parse-error.md —
   * TINYTINKERER-FRONTEND-K.)
   */
  silentWhenNoJson?: boolean
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
  response?: Response,
  options?: ModelJsonOptions
): T => {
  const stripped = stripModelJsonFences(text)

  // A response with no JSON value at all is the model declining to emit a
  // structured answer (pure prose) — distinct from a truncated/malformed value.
  // At a prose-tolerant call site this is benign and expected, so surface it
  // WITHOUT telemetry. Everything else (truncation, schema mismatch, and ALL
  // failures when the option is off) flows through `parseWithTelemetry` below and
  // stays loud.
  if (options?.silentWhenNoJson && !containsJsonValue(stripped)) {
    throw new ModelJsonError('no_json', messages.parseError)
  }

  let parsed: unknown
  try {
    // parseRobustModelJson tolerates sloppy-but-complete model output (prose
    // wrapping, single quotes, trailing commas) but never repairs a truncated
    // value — so genuine incompleteness still surfaces as a parse_error.
    // Pass `stripped` as rawInput so Sentry captures what the model returned,
    // making parse_error events self-diagnosable without breadcrumbs or replays.
    parsed = parseWithTelemetry<unknown>(
      metadata,
      'parse_error',
      messages.parseError,
      () => parseRobustModelJson(stripped),
      response,
      stripped
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
      response,
      // Capture the offending model-output shape so a schema_error is
      // self-diagnosable: the ZodError alone says what we *expected* but not what
      // the model actually produced (e.g. an array or a string where an object
      // was required — TINYTINKERER-FRONTEND-12). We serialize the *parsed* value
      // (the exact shape that failed validation) and fall back to the raw stripped
      // text if it can't be serialized.
      describeOffendingShape(parsed, stripped)
    )
  } catch (error) {
    throw new ModelJsonError('schema_error', messages.schemaError, { cause: error })
  }
}

// Render the value that failed schema validation as a compact, diagnosable string
// for the `failure.raw_input` Sentry context. Leads with the runtime type (so a
// wrong-top-level-type mismatch — the most common schema_error — is obvious even
// after truncation) followed by the serialized value. Never throws: a value that
// can't be JSON-serialized falls back to the raw model text.
const describeOffendingShape = (parsed: unknown, fallbackRaw: string): string => {
  const type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
  try {
    return `[${type}] ${JSON.stringify(parsed)}`
  } catch {
    return `[${type}] ${fallbackRaw}`
  }
}
