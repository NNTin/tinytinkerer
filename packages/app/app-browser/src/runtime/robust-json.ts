import JSON5 from 'json5'

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
//      commas, unquoted keys, comments).
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
