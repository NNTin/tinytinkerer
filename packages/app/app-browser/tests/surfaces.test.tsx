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
    sendPrompt: vi.fn(
      (_prompt: string, _conversationId?: string, options?: { onAdmitted?: () => void }) => {
        options?.onAdmitted?.()
        return Promise.resolve()
      }
    ),
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

const appTool = vi.hoisted(() => {
  const summarizeActivity = vi.fn(() => ({
    title: 'App tool',
    status: 'ok' as const,
    sections: []
  }))
  return {
    summarizeActivity,
    group: {
      id: 'app',
      label: 'App',
      tools: [{ id: 'app-tool', summarizeActivity }]
    }
  }
})

// The pre-send disclosure gate (issue #481) is always present on a real app and
// simply never gates anything without a configured disclosure — modelled here as
// the same "no disclosure" shape, so these tests keep asserting the cap-refusal
// and activity behaviour they were written for rather than the gate.
const disclosureResolvers = vi.hoisted(() => [] as ((allowed: boolean) => void)[])

const preSendDisclosureState = vi.hoisted(() => ({
  disclosure: undefined as { version: string } | undefined,
  pending: null as { requestId: number; prompt: string } | null,
  isRequired: vi.fn(() => false),
  request: vi.fn((prompt: string) => ({
    requestId: 1,
    decided: new Promise<boolean>((resolve) => {
      disclosureResolvers.push(resolve)
    }),
    prompt
  })),
  accept: vi.fn(() => Promise.resolve()),
  dismiss: vi.fn()
}))

/** Answers whatever request the gate is currently holding. */
const settleDisclosure = (allowed: boolean): void => {
  for (const resolve of disclosureResolvers.splice(0)) resolve(allowed)
}

vi.mock('../src/pre-send-disclosure.js', () => ({
  preSendDisclosureStoreFor: () => ({ getState: () => preSendDisclosureState }),
  usePreSendDisclosureStore: (selector: (state: typeof preSendDisclosureState) => unknown) =>
    selector(preSendDisclosureState)
}))

vi.mock('../src/app.js', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useBrowserApp: () => ({ appToolGroup: appTool.group }),
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

import { useChatSurfaceController, type SubmitPromptResult } from '../src/surfaces.js'

beforeEach(() => {
  chatState.hydrated = true
  chatState.events = []
  chatState.isRunning = false
  chatState.isRetryPending = false
  chatState.cooldownUntil = undefined
  chatState.conversationId = 'a'
  chatState.conversations = { a: { id: 'a', title: 'A', isRunning: false } }
  chatState.conversationOrder = ['a']
  chatState.sendPrompt
    .mockReset()
    .mockImplementation(
      (_prompt: string, _conversationId?: string, options?: { onAdmitted?: () => void }) => {
        // The default fake is an ADMITTED send, matching a healthy store.
        options?.onAdmitted?.()
        return Promise.resolve()
      }
    )
  chatState.canStartRun.mockReset().mockReturnValue(true)
  preSendDisclosureState.isRequired.mockReset().mockReturnValue(false)
  disclosureResolvers.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChatSurfaceController app-tool activity', () => {
  it('resolves the summarizer carried by an app-local tool', () => {
    const { result } = renderHook(() => useChatSurfaceController())
    expect(result.current.resolveActivitySummarizer('app-tool')).toBe(appTool.summarizeActivity)
  })
})

// Acknowledgement is not admission (issue #481 re-review, finding 3). The
// dialog can sit open long enough for the cooldown or the run cap to change,
// and several sends can join one dialog and then compete for a single slot —
// so a held attempt reports whether it actually got a run, not whether the
// reader said yes.
/** Narrows a submit result to the held branch, failing loudly if it is not. */
const admittedOf = (result: SubmitPromptResult | undefined): Promise<boolean> => {
  if (result?.status !== 'held') {
    throw new Error(`expected a held submit result, got ${result?.status ?? 'undefined'}`)
  }
  return result.admitted
}

describe('useChatSurfaceController held sends', () => {
  it('reports admitted only when the send actually gets a run', async () => {
    preSendDisclosureState.isRequired.mockReturnValue(true)
    const { result } = renderHook(() => useChatSurfaceController())

    let outcome: SubmitPromptResult | undefined
    act(() => {
      outcome = result.current.submitPrompt('a question')
    })
    expect(outcome?.status).toBe('held')

    // The reader acknowledges, and the send is admitted.
    await act(async () => {
      preSendDisclosureState.isRequired.mockReturnValue(false)
      settleDisclosure(true)
      await Promise.resolve()
    })

    // The send is told how to report admission, rather than being expected to
    // signal it through a resolved `Promise<void>` that every refusal shares.
    const [prompt, conversationId, sendOptions] = chatState.sendPrompt.mock.calls[0] ?? []
    expect(prompt).toBe('a question')
    expect(conversationId).toBeUndefined()
    expect(typeof sendOptions?.onAdmitted).toBe('function')
    await expect(admittedOf(outcome)).resolves.toBe(true)
  })

  it('reports NOT admitted when the run is refused after acknowledgement', async () => {
    // The bug this closes: the composer cleared a prompt that was never sent,
    // because the promise meant "accepted" rather than "admitted".
    preSendDisclosureState.isRequired.mockReturnValue(true)
    // A send that never commits — exactly what the run cap, the re-entry latch
    // and the cooldown all do: return early, resolving the same way a real run
    // does, without ever calling `onAdmitted`.
    chatState.sendPrompt.mockImplementation(() => Promise.resolve())
    const { result } = renderHook(() => useChatSurfaceController())

    let outcome: SubmitPromptResult | undefined
    act(() => {
      outcome = result.current.submitPrompt('a question')
    })

    await act(async () => {
      preSendDisclosureState.isRequired.mockReturnValue(false)
      settleDisclosure(true)
      await Promise.resolve()
    })

    await expect((outcome as { admitted: Promise<boolean> }).admitted).resolves.toBe(false)
  })

  it('reports NOT admitted when the reader dismisses', async () => {
    preSendDisclosureState.isRequired.mockReturnValue(true)
    const { result } = renderHook(() => useChatSurfaceController())

    let outcome: SubmitPromptResult | undefined
    act(() => {
      outcome = result.current.submitPrompt('a question')
    })
    await act(async () => {
      settleDisclosure(false)
      await Promise.resolve()
    })

    expect(chatState.sendPrompt).not.toHaveBeenCalled()
    await expect((outcome as { admitted: Promise<boolean> }).admitted).resolves.toBe(false)
  })
})

describe('useChatSurfaceController cap refusal (issue #430)', () => {
  it('refuses the send, sets a notice, and does not call sendPrompt when canStartRun() is false', () => {
    chatState.canStartRun.mockReturnValue(false)
    const { result } = renderHook(() => useChatSurfaceController())

    let outcome: { status: string } | undefined
    act(() => {
      outcome = result.current.submitPrompt('hello')
    })

    // Refused outright, not held: the run cap is not something a reader can
    // answer, so nothing is waiting on them (issue #481 rework).
    expect(outcome?.status).toBe('refused')
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
    let outcome: { status: string } | undefined
    act(() => {
      outcome = result.current.submitPrompt('through')
    })

    expect(outcome?.status).toBe('sent')
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
