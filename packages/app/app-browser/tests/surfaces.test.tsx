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

// surfaces.tsx defines its own useChatStoreWithEquality locally (issue #430
// review: keeping the zustand/traditional import out of the eager app.ts), via
// `useBrowserApp().stores.chat` + the real `useStoreWithEqualityFn`. So this
// mock's `useBrowserApp` must return something shaped like a real StoreApi
// (subscribe/getState/getInitialState) wrapping the same mutable `chatState`
// the rest of this file drives — a no-op subscribe is fine since every test
// below mutates `chatState` directly then forces a fresh render via
// `act(() => rerender())`, and useSyncExternalStoreWithSelector re-reads the
// snapshot on every render regardless of subscription notifications.
const fakeChatStoreApi = {
  getState: () => chatState,
  getInitialState: () => chatState,
  subscribe: () => () => undefined
}

vi.mock('../src/app.js', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useBrowserApp: () => ({ stores: { chat: fakeChatStoreApi } }),
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

import { conversationSummariesEqual, useChatSurfaceController } from '../src/surfaces.js'

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

describe('conversationSummariesEqual (issue #430 review: typed equality selector)', () => {
  // This is the render-skip mechanism itself: useChatSurfaceController wires
  // it into useChatStoreWithEquality so a background conversation's stream —
  // which produces a FRESH array every store change but leaves every
  // id/title/isRunning triple unchanged — never forces a re-render.
  it('treats a fresh array with identical entries as equal', () => {
    const a = [{ id: 'a', title: 'A', isRunning: false }]
    const b = [{ id: 'a', title: 'A', isRunning: false }]
    expect(conversationSummariesEqual(a, b)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('treats the same reference as equal', () => {
    const a = [{ id: 'a', title: 'A', isRunning: false }]
    expect(conversationSummariesEqual(a, a)).toBe(true)
  })

  it('detects a changed isRunning flag (a background run starting/ending)', () => {
    const a = [{ id: 'a', title: 'A', isRunning: false }]
    const b = [{ id: 'a', title: 'A', isRunning: true }]
    expect(conversationSummariesEqual(a, b)).toBe(false)
  })

  it('detects a changed title (auto-title-from-first-prompt)', () => {
    const a = [{ id: 'a', title: 'New conversation', isRunning: false }]
    const b = [{ id: 'a', title: 'What is the capital of France?', isRunning: false }]
    expect(conversationSummariesEqual(a, b)).toBe(false)
  })

  it('detects a changed length (conversation created or deleted)', () => {
    const a = [{ id: 'a', title: 'A', isRunning: false }]
    const b = [
      { id: 'a', title: 'A', isRunning: false },
      { id: 'b', title: 'B', isRunning: false }
    ]
    expect(conversationSummariesEqual(a, b)).toBe(false)
  })

  it('detects a changed order', () => {
    const a = [
      { id: 'a', title: 'A', isRunning: false },
      { id: 'b', title: 'B', isRunning: false }
    ]
    const b = [
      { id: 'b', title: 'B', isRunning: false },
      { id: 'a', title: 'A', isRunning: false }
    ]
    expect(conversationSummariesEqual(a, b)).toBe(false)
  })

  it('treats two empty lists as equal', () => {
    expect(conversationSummariesEqual([], [])).toBe(true)
  })
})
