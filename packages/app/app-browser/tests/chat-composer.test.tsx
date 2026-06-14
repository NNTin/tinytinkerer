// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stop = vi.fn()

// Isolate the composer from the Web Speech integration — we only care that it
// stops any in-progress dictation when a prompt is submitted.
vi.mock('../src/web-speech.js', () => ({
  useWebSpeechInput: () => ({
    visible: false,
    available: false,
    listening: false,
    error: null,
    toggle: vi.fn(),
    stop
  })
}))

import { useChatComposer } from '../src/surfaces.js'

beforeEach(() => {
  stop.mockClear()
})

describe('useChatComposer', () => {
  it('clears the input immediately when the prompt is accepted (issue #206)', () => {
    const submitPrompt = vi.fn(() => true)
    const { result } = renderHook(() => useChatComposer(submitPrompt))

    act(() => {
      result.current.setPrompt('What is new?')
    })
    expect(result.current.prompt).toBe('What is new?')

    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.handleSubmit()
    })

    // The decision is returned synchronously and the input is cleared without
    // waiting for the backend response to resolve.
    expect(accepted).toBe(true)
    expect(submitPrompt).toHaveBeenCalledWith('What is new?')
    expect(result.current.prompt).toBe('')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('keeps the input when the send is rejected (blocked while running / cooling down)', () => {
    // submitPrompt returns false whenever sending is blocked (empty prompt,
    // agent running, or cooling down) — the input must be preserved so the user
    // does not lose their message.
    const submitPrompt = vi.fn(() => false)
    const { result } = renderHook(() => useChatComposer(submitPrompt))

    act(() => {
      result.current.setPrompt('Blocked message')
    })

    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.handleSubmit()
    })

    expect(accepted).toBe(false)
    expect(submitPrompt).toHaveBeenCalledWith('Blocked message')
    expect(result.current.prompt).toBe('Blocked message')
  })
})
