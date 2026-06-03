import { describe, expect, it } from 'vitest'
import {
  feedbackInputSchema,
  pluginActivationStateSchema
} from '../src/index.js'

describe('feedbackInputSchema', () => {
  it('accepts a message with an optional category', () => {
    expect(feedbackInputSchema.parse({ message: 'Love it', category: 'praise' })).toEqual({
      message: 'Love it',
      category: 'praise'
    })
    expect(feedbackInputSchema.parse({ message: 'Just a message' })).toEqual({
      message: 'Just a message'
    })
  })

  it('rejects an empty message', () => {
    expect(feedbackInputSchema.safeParse({ message: '' }).success).toBe(false)
  })

  it('rejects an over-long message', () => {
    expect(
      feedbackInputSchema.safeParse({ message: 'x'.repeat(2001) }).success
    ).toBe(false)
  })

  it('rejects an unknown category', () => {
    expect(
      feedbackInputSchema.safeParse({ message: 'hi', category: 'other' }).success
    ).toBe(false)
  })
})

describe('pluginActivationStateSchema', () => {
  it('parses a map of plugin ids to booleans', () => {
    expect(
      pluginActivationStateSchema.parse({ 'send-feedback': true, other: false })
    ).toEqual({ 'send-feedback': true, other: false })
  })

  it('rejects non-boolean values', () => {
    expect(
      pluginActivationStateSchema.safeParse({ 'send-feedback': 'yes' }).success
    ).toBe(false)
  })
})
