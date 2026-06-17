import { describe, expect, it } from 'vitest'
import { feedbackInputSchema, pluginActivationStateSchema } from '../src/index.js'

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
