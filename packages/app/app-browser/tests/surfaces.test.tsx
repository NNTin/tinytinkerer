// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useChatSurfaceController reads the chat/auth/settings/status stores through
// './app' — mock that module (like context-gauge.test.tsx) instead of standing
// up a full BrowserApp, and drive it through a shared mutable fake state object.

type FakeConversation = { id: string; title: string; isRunning: boolean }

const chatState = vi.hoisted(() => {
  // Annotated (not asserted) so the per-test reassignments below may add and
  // remove conversation ids freely.
  const conversations: Record<string, FakeConversation> = {
    a: { id: 'a', title: 'A', isRunning: false }
  }
  return {
    hydrated: true,
    events: [] as unknown[],
    isRunning: false,
    isRetryPending: false,
    cooldownUntil: undefined as string | undefined,
    conversationId: 'a',
    conversations,
    conversationOrder: ['a'],
    initialize: vi.fn(() => Promise.resolve()),
    sendPrompt: vi.fn(() => Promise.resolve()),
    rerunLastPrompt: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    resetConversation: vi.fn(() => Promise.resolve()),
    cancelRetry: vi.fn(),
    canStartRun: vi.fn(() => true),
    selectConversation: vi.fn(() => Promise.resolve()),
    startNewConversation: vi.fn(() => Promise.resolve()),
    deleteConversation: vi.fn(() => Promise.resolve())
  }
})

vi.mock('../src/app.js', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useAuthStore: (selector: (state: { token: string | null }) => unknown) =>
    selector({ token: null }),
  useSettingsStore: (
    selector: (state: { showReasoningActivity: boolean; mcpServers: unknown[] }) => unknown
  ) => selector({ showReasoningActivity: false, mcpServers: [] }),
  useStatusStore: (selector: (state: { refresh: () => Promise<void> }) => unknown) =>
    selector({ refresh: () => Promise.resolve() })
}))

vi.mock('../src/status.js', () => ({
  startStatusPolling: () => () => undefined
}))

vi.mock('../src/plugins/use-plugin-modules.js', () => ({
  usePluginModules: () => []
}))

import { useChatSurfaceController } from '../src/surfaces.js'

beforeEach(() => {
  chatState.hydrated = true
  chatState.events = []
  chatState.isRunning = false
  chatState.isRetryPending = false
  chatState.cooldownUntil = undefined
  chatState.conversationId = 'a'
  chatState.conversations = { a: { id: 'a', title: 'A', isRunning: false } }
  chatState.conversationOrder = ['a']
  chatState.sendPrompt.mockClear()
  chatState.canStartRun.mockReset().mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChatSurfaceController cap refusal (issue #430)', () => {
  it('refuses the send, sets a notice, and does not call sendPrompt when canStartRun() is false', () => {
    chatState.canStartRun.mockReturnValue(false)
    const { result } = renderHook(() => useChatSurfaceController())

    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.submitPrompt('hello')
    })

    expect(accepted).toBe(false)
    expect(chatState.sendPrompt).not.toHaveBeenCalled()
    expect(result.current.sendRefusalNotice).toMatch(/Parallel run limit reached/)
  })

  it('clears the notice on the next accepted submit', () => {
    chatState.canStartRun.mockReturnValue(false)
    const { result } = renderHook(() => useChatSurfaceController())

    act(() => {
      result.current.submitPrompt('blocked')
    })
    expect(result.current.sendRefusalNotice).not.toBeNull()

    chatState.canStartRun.mockReturnValue(true)
    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.submitPrompt('through')
    })

    expect(accepted).toBe(true)
    expect(chatState.sendPrompt).toHaveBeenCalledWith('through')
    expect(result.current.sendRefusalNotice).toBeNull()
  })

  it('clears the notice when the active conversation changes', () => {
    chatState.canStartRun.mockReturnValue(false)
    const { result, rerender } = renderHook(() => useChatSurfaceController())

    act(() => {
      result.current.submitPrompt('blocked')
    })
    expect(result.current.sendRefusalNotice).not.toBeNull()

    chatState.conversationId = 'b'
    chatState.conversations = {
      ...chatState.conversations,
      b: { id: 'b', title: 'B', isRunning: false }
    }
    act(() => {
      rerender()
    })

    expect(result.current.sendRefusalNotice).toBeNull()
  })

  it('clears the notice on its own after a few seconds', () => {
    vi.useFakeTimers()
    chatState.canStartRun.mockReturnValue(false)
    const { result } = renderHook(() => useChatSurfaceController())

    act(() => {
      result.current.submitPrompt('blocked')
    })
    expect(result.current.sendRefusalNotice).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(6000)
    })

    expect(result.current.sendRefusalNotice).toBeNull()
  })
})

describe('useChatSurfaceController conversation summaries (issue #430)', () => {
  it('exposes the conversation list and active id for the switcher', () => {
    chatState.conversationOrder = ['a', 'b']
    chatState.conversations = {
      a: { id: 'a', title: 'A', isRunning: false },
      b: { id: 'b', title: 'B', isRunning: true }
    }
    const { result } = renderHook(() => useChatSurfaceController())

    expect(result.current.activeConversationId).toBe('a')
    expect(result.current.conversations).toEqual([
      { id: 'a', title: 'A', isRunning: false },
      { id: 'b', title: 'B', isRunning: true }
    ])
  })
})
