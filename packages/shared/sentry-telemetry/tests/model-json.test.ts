import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setCaptureExceptionSink, type CaptureExceptionSink } from '../src/capture.js'
import {
  ModelJsonError,
  parseModelJsonWithTelemetry,
  parseRobustModelJson,
  stripModelJsonFences
} from '../src/model-json.js'

const sink = vi.fn<CaptureExceptionSink>()

const metadata = {
  area: 'react.decide',
  origin: 'edge' as const,
  method: 'POST',
  url: 'https://api.example.com/api/models/chat'
}

// A tiny structural schema (no zod dependency) that accepts only `{ ok: true }`.
const okSchema = {
  parse(value: unknown): { ok: true } {
    if (typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true) {
      return { ok: true }
    }
    throw new Error('schema mismatch')
  }
}

const messages = {
  parseError: 'content was not valid JSON',
  schemaError: 'content did not match the schema'
}

describe('parseRobustModelJson', () => {
  it('parses well-formed strict JSON', () => {
    expect(parseRobustModelJson('{"kind":"final"}')).toEqual({ kind: 'final' })
  })

  it('recovers a complete object wrapped in prose', () => {
    const text = 'Sure! Here is the decision: {"kind":"final"} — hope that helps.'
    expect(parseRobustModelJson(text)).toEqual({ kind: 'final' })
  })

  it('recovers sloppy-but-complete JSON5 (single quotes, trailing commas)', () => {
    expect(parseRobustModelJson("{ kind: 'final', }")).toEqual({ kind: 'final' })
  })

  it('throws on pure prose with no JSON value', () => {
    expect(() => parseRobustModelJson('I now have enough information.')).toThrow()
  })

  it('NEVER fabricates a truncated value (no auto-closing brackets)', () => {
    // A cut-off stream: the closing brace never arrives. Robustness must not
    // guess the rest — it must throw so the caller falls back / surfaces.
    expect(() => parseRobustModelJson('{"kind":"action","toolId":"web-search","inp')).toThrow()
  })

  it('does not treat a brace inside a string as the closing brace (extraction path)', () => {
    // A prose preamble makes strict JSON.parse fail, so this exercises
    // extractBalancedJson: its string-awareness must skip the `}` inside "a } b"
    // and only stop at the real closing brace.
    expect(parseRobustModelJson('Here you go: {"q":"a } b"}')).toEqual({ q: 'a } b' })
  })
})

describe('stripModelJsonFences', () => {
  it('strips a ```json fence', () => {
    expect(stripModelJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips a bare ``` fence', () => {
    expect(stripModelJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('leaves unfenced text untouched (aside from trimming)', () => {
    expect(stripModelJsonFences('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('parseModelJsonWithTelemetry', () => {
  beforeEach(() => {
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('returns the validated value for fenced, prose-wrapped content', () => {
    const value = parseModelJsonWithTelemetry(metadata, '```json\n{"ok":true}\n```', okSchema, messages)
    expect(value).toEqual({ ok: true })
    expect(sink).not.toHaveBeenCalled()
  })

  it('throws a parse_error ModelJsonError and captures it for unparseable content', () => {
    expect(() => parseModelJsonWithTelemetry(metadata, 'I cannot help.', okSchema, messages)).toThrow(
      ModelJsonError
    )

    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({ failure_kind: 'parse_error', request_area: 'react.decide' })
  })

  it('throws a schema_error ModelJsonError when JSON is valid but the wrong shape', () => {
    let caught: unknown
    try {
      parseModelJsonWithTelemetry(metadata, '{"ok":false}', okSchema, messages)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ModelJsonError)
    expect((caught as ModelJsonError).kind).toBe('schema_error')
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({ failure_kind: 'schema_error' })
  })

  it('stays loud on a TRUNCATED value: captures parse_error and never fabricates', () => {
    expect(() =>
      parseModelJsonWithTelemetry(metadata, '{"ok":tr', okSchema, messages)
    ).toThrow(ModelJsonError)
    expect(sink).toHaveBeenCalledTimes(1)
    expect((sink.mock.calls[0]?.[1])?.tags).toMatchObject({ failure_kind: 'parse_error' })
  })

  it('preserves the underlying error as `cause`', () => {
    let caught: unknown
    try {
      parseModelJsonWithTelemetry(metadata, 'not json', okSchema, messages)
    } catch (error) {
      caught = error
    }
    expect((caught as ModelJsonError).cause).toBeInstanceOf(Error)
  })
})
