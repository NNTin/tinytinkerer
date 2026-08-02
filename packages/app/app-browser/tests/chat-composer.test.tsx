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

// The composer reads its app's pre-send disclosure gate (issue #481) to know
// whether a refused submit is one it should resume once the reader acknowledges.
// A mutable fake stands in for the store; `listeners` lets a test publish an
// acceptance the way the real dialog does.
const gate = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = {
    pending: null as { requestId: number; prompt: string } | null,
    lastAccepted: null as number | null
  }
  return {
    state,
    listeners,
    publish: (next: Partial<typeof state>) => {
      Object.assign(state, next)
      for (const listener of listeners) listener()
    },
    reset: () => {
      state.pending = null
      state.lastAccepted = null
    }
  }
})

vi.mock('../src/app.js', () => ({ useBrowserApp: () => ({}) }))

vi.mock('../src/pre-send-disclosure.js', () => ({
  preSendDisclosureStoreFor: () => ({ getState: () => gate.state }),
  // A real subscription, so a published acceptance actually re-renders the hook
  // — the whole behaviour under test is an effect keyed on that value.
  usePreSendDisclosureStore: (selector: (state: typeof gate.state) => unknown) => {
    const [, force] = useState(0)
    useEffect(() => {
      const listener = () => force((n) => n + 1)
      gate.listeners.add(listener)
      return () => {
        gate.listeners.delete(listener)
      }
    }, [])
    return selector(gate.state)
  }
}))

import { useEffect, useState } from 'react'
import { useChatComposer } from '../src/surfaces.js'

beforeEach(() => {
  stop.mockClear()
  gate.reset()
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

  // Resuming a send the pre-send disclosure held (issue #481). The dialog never
  // sends: it records the acknowledgement and publishes the request id, and the
  // composer re-runs the ONE `submitPrompt` path. Two send paths would be two
  // places for the clear-on-accept rule and the disclosure check to drift.
  describe('pre-send disclosure gate', () => {
    it('re-submits and clears once the held request is acknowledged', () => {
      // Refuses while the gate is closed, accepts once it has been satisfied —
      // exactly what the real `submitPrompt` does around `isRequired()`.
      let gated = true
      const submitPrompt = vi.fn(() => !gated)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('Summarize this page.')
      })
      act(() => {
        gate.state.pending = { requestId: 7, prompt: 'Summarize this page.' }
        result.current.handleSubmit()
      })

      // Nothing sent, and the reader still has their question.
      expect(result.current.prompt).toBe('Summarize this page.')

      act(() => {
        gated = false
        gate.publish({ pending: null, lastAccepted: 7 })
      })

      expect(submitPrompt).toHaveBeenCalledTimes(2)
      expect(submitPrompt).toHaveBeenLastCalledWith('Summarize this page.')
      expect(result.current.prompt).toBe('')
    })

    it('keeps the text when the reader dismisses instead of acknowledging', () => {
      const submitPrompt = vi.fn(() => false)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('Where can I find the plugin docs?')
      })
      act(() => {
        gate.state.pending = { requestId: 3, prompt: 'Where can I find the plugin docs?' }
        result.current.handleSubmit()
      })
      act(() => {
        // `dismiss()` clears `pending` and never touches `lastAccepted`.
        gate.publish({ pending: null })
      })

      expect(submitPrompt).toHaveBeenCalledTimes(1)
      expect(result.current.prompt).toBe('Where can I find the plugin docs?')
    })

    it('does not resume a send refused for an unrelated reason', () => {
      // The run cap refused this one, so no gate request exists to hold it. An
      // acknowledgement raised by some other composer must not send it.
      const submitPrompt = vi.fn(() => false)
      const { result } = renderHook(() => useChatComposer(submitPrompt))

      act(() => {
        result.current.setPrompt('Blocked by the run cap')
        gate.state.pending = null
      })
      act(() => {
        result.current.handleSubmit()
      })
      act(() => {
        gate.publish({ lastAccepted: 11 })
      })

      expect(submitPrompt).toHaveBeenCalledTimes(1)
      expect(result.current.prompt).toBe('Blocked by the run cap')
    })
  })
})
