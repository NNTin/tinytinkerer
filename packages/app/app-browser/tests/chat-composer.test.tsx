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

// `submitPrompt`'s three outcomes (issue #481). `sent` and `refused` are
// constants; `held` carries its own decision, which is what the composer waits
// on.
const SENT = { status: 'sent' } as const
const REFUSED = { status: 'refused' } as const
const held = (requestId: number) => {
  let settle: (allowed: boolean) => void = () => undefined
  const decided = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  return { result: { status: 'held' as const, requestId, decided }, settle }
}

beforeEach(() => {
  stop.mockClear()
})

describe('useChatComposer', () => {
  it('clears the input immediately when the prompt is accepted (issue #206)', () => {
    const submitPrompt = vi.fn(() => SENT)
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
    const submitPrompt = vi.fn(() => REFUSED)
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

  // A send held by the pre-send disclosure (issue #481). The composer waits on
  // THAT attempt's own decision, so nothing is inferred from shared state and two
  // surfaces submitting identical text cannot resume each other.
  describe('pre-send disclosure gate', () => {
    it('keeps the text while held, and clears it once acknowledged', async () => {
      const { result: heldResult, settle } = held(7)
      const submitPrompt = vi.fn(() => heldResult)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('Summarize this page.')
      })
      let accepted: boolean | undefined
      act(() => {
        accepted = result.current.handleSubmit()
      })

      // Not "sent" — the reader still has to answer, and still has their words.
      expect(accepted).toBe(false)
      expect(result.current.prompt).toBe('Summarize this page.')

      await act(async () => {
        settle(true)
        await heldResult.decided
      })

      expect(result.current.prompt).toBe('')
      // The composer never re-submits: the decision carried the send.
      expect(submitPrompt).toHaveBeenCalledTimes(1)
    })

    it('keeps the text when the reader dismisses instead of acknowledging', async () => {
      const { result: heldResult, settle } = held(3)
      const submitPrompt = vi.fn(() => heldResult)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('Where can I find the plugin docs?')
      })
      act(() => {
        result.current.handleSubmit()
      })
      await act(async () => {
        settle(false)
        await heldResult.decided
      })

      expect(result.current.prompt).toBe('Where can I find the plugin docs?')
    })

    it('does not clear on another attempt being approved', async () => {
      // Two composers, same words. This one's attempt is never settled; the
      // other's is. Correlating by prompt text — what the first revision did —
      // would have cleared this one.
      const mine = held(1)
      const theirs = held(2)
      const submitPrompt = vi.fn(() => mine.result)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('the same question')
      })
      act(() => {
        result.current.handleSubmit()
      })
      await act(async () => {
        theirs.settle(true)
        await theirs.result.decided
      })

      expect(result.current.prompt).toBe('the same question')
    })
  })
})
