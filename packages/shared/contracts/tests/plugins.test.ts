import { describe, expect, it } from 'vitest'
import {
  boundedJson,
  boundedPreview,
  feedbackInputSchema,
  mediaRefFor,
  partitionToolResultMedia,
  pluginActivationStateSchema,
  pluginConfigStateSchema,
  toolResultImageMediaSchema
} from '../src/index.js'

describe('feedbackInputSchema', () => {
  it('accepts a bug report and an idea', () => {
    expect(feedbackInputSchema.parse({ message: 'It crashed', category: 'bug' })).toEqual({
      message: 'It crashed',
      category: 'bug'
    })
    expect(feedbackInputSchema.parse({ message: 'Add dark mode', category: 'idea' })).toEqual({
      message: 'Add dark mode',
      category: 'idea'
    })
  })

  it('requires a category', () => {
    expect(feedbackInputSchema.safeParse({ message: 'Just a message' }).success).toBe(false)
  })

  it('rejects an empty message', () => {
    expect(feedbackInputSchema.safeParse({ message: '', category: 'bug' }).success).toBe(false)
  })

  it('rejects an over-long message', () => {
    expect(
      feedbackInputSchema.safeParse({ message: 'x'.repeat(2001), category: 'bug' }).success
    ).toBe(false)
  })

  it('rejects retired or unknown categories', () => {
    for (const category of ['praise', 'general', 'other']) {
      expect(feedbackInputSchema.safeParse({ message: 'hi', category }).success).toBe(false)
    }
  })
})

describe('pluginActivationStateSchema', () => {
  it('parses a map of plugin ids to booleans', () => {
    expect(pluginActivationStateSchema.parse({ 'send-feedback': true, other: false })).toEqual({
      'send-feedback': true,
      other: false
    })
  })

  it('rejects non-boolean values', () => {
    expect(pluginActivationStateSchema.safeParse({ 'send-feedback': 'yes' }).success).toBe(false)
  })
})

describe('pluginConfigStateSchema', () => {
  it('parses a map of plugin ids to (settingKey -> string|boolean) maps', () => {
    expect(
      pluginConfigStateSchema.parse({
        'choice-prompt': { presentation: 'composer', compact: true }
      })
    ).toEqual({ 'choice-prompt': { presentation: 'composer', compact: true } })
  })

  it('rejects a non-primitive setting value', () => {
    expect(
      pluginConfigStateSchema.safeParse({ 'choice-prompt': { presentation: { nested: 1 } } })
        .success
    ).toBe(false)
  })
})

describe('boundedPreview', () => {
  it('returns values at the cap unchanged and truncates values over the cap', () => {
    expect(boundedPreview('abc', 3)).toBe('abc')
    expect(boundedPreview('abcd', 3)).toBe('abc…')
  })

  it('serializes non-string values and falls back for cyclic values', () => {
    expect(boundedPreview({ a: 1 }, 20)).toBe('{"a":1}')

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(boundedPreview(cyclic, 20)).toBe('[object Object]')
  })
})

describe('toolResultImageMediaSchema', () => {
  const validImage = {
    kind: 'image' as const,
    dataUrl: 'data:image/png;base64,abcd',
    mimeType: 'image/png',
    width: 100,
    height: 50,
    description: 'A screenshot'
  }

  it('accepts a valid image', () => {
    expect(toolResultImageMediaSchema.parse(validImage)).toEqual(validImage)
  })

  it('rejects a dataUrl that is not a data:image/ URL', () => {
    expect(
      toolResultImageMediaSchema.safeParse({ ...validImage, dataUrl: 'https://example.com/x.png' })
        .success
    ).toBe(false)
  })

  it('rejects a missing field', () => {
    const withoutDescription: Record<string, unknown> = { ...validImage }
    delete withoutDescription.description
    expect(toolResultImageMediaSchema.safeParse(withoutDescription).success).toBe(false)
  })
})

describe('mediaRefFor', () => {
  it('builds the canonical media ref', () => {
    expect(mediaRefFor('abc', 0)).toBe('media:abc#0')
  })
})

describe('partitionToolResultMedia', () => {
  const validImage = {
    kind: 'image' as const,
    dataUrl: 'data:image/png;base64,abcd',
    mimeType: 'image/png',
    width: 100,
    height: 50,
    description: 'A screenshot'
  }

  it('extracts a valid media array and strips the media key from rest', () => {
    const result = partitionToolResultMedia({ text: 'hello', media: [validImage] })
    expect(result.media).toEqual([validImage])
    expect(result.rest).toEqual({ text: 'hello' })
  })

  it('drops a malformed media entry', () => {
    const result = partitionToolResultMedia({
      media: [validImage, { kind: 'image', dataUrl: 'not-a-data-url' }]
    })
    expect(result.media).toEqual([validImage])
  })

  it('returns no media for a plain object with no media key', () => {
    const input = { text: 'hello' }
    expect(partitionToolResultMedia(input)).toEqual({ rest: input, media: [] })
  })

  it('never throws and passes non-object input through unchanged', () => {
    for (const input of ['a string', 42, null, ['array', 'input']]) {
      expect(partitionToolResultMedia(input)).toEqual({ rest: input, media: [] })
    }
  })
})

describe('boundedJson', () => {
  it('pretty-prints serializable values and truncates values over the cap', () => {
    expect(boundedJson({ a: 1 }, 20)).toBe('{\n  "a": 1\n}')
    const truncated = boundedJson({ value: 'x'.repeat(50) }, 20)
    expect(truncated).toHaveLength(21)
    expect(truncated.startsWith('{\n  "value": "')).toBe(true)
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('fails open for cyclic values', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(boundedJson(cyclic, 20)).toBe('(value could not be displayed)')
  })
})
