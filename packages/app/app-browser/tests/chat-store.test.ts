import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { BrowserShell } from '../src/shell.js'
import type { AuthStore } from '../src/stores/auth-store.js'
import type { SettingsStore } from '../src/stores/settings-store.js'

const mockExecuteChatPrompt = vi.hoisted(() => vi.fn())
const mockCanSendPrompt = vi.hoisted(() => vi.fn(() => true))
const mockCreateBrowserRuntimeFactory = vi.hoisted(() => vi.fn(() => ({ create: vi.fn() })))

vi.mock('@tinytinkerer/app-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tinytinkerer/app-core')>()
  return {
    ...original,
    executeChatPrompt: mockExecuteChatPrompt,
    canSendPrompt: mockCanSendPrompt
  }
})

vi.mock('../src/runtime/get-runtime.js', () => ({
  createBrowserRuntimeFactory: mockCreateBrowserRuntimeFactory
}))

const { createChatStore } = await import('../src/stores/chat-store.js')
const { rateLimitCooldownKey } = await import('@tinytinkerer/app-core')

const makeShell = (): BrowserShell =>
  ({
    config: {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      authMode: 'hybrid',
      hostToken: null
    },
    conversations: {
      createConversation: vi.fn(),
      getLatestConversation: vi.fn(),
      loadConversationEvents: vi.fn(),
      appendEvent: vi.fn(),
      clearConversationEvents: vi.fn()
    },
    preferences: {
      get: vi.fn(),
      set: vi.fn()
    },
    authTokens: {
      getStoredToken: vi.fn(),
      setStoredToken: vi.fn(),
      clearStoredToken: vi.fn(),
      getHostToken: vi.fn()
    },
    statusGateway: {}
  }) as unknown as BrowserShell

const makeAuthStore = (): AuthStore =>
  ({ getState: vi.fn(() => ({ token: 'tok' })) }) as unknown as AuthStore
// A real zustand store so chat-store's subscribe()/getState() work and tests can
// simulate a base-URL switch via setState.
const makeSettingsStore = (initial: { litellmBaseUrl?: string } = {}): SettingsStore =>
  createStore(() => ({
    selectedModel: 'gpt-4o',
    litellmBaseUrl: 'https://litellm-a.example.com',
    ...initial
  })) as unknown as SettingsStore

beforeEach(() => {
  vi.clearAllMocks()
  mockCanSendPrompt.mockReturnValue(true)
})

describe('createChatStore', () => {
  it('sets isRetryPending to false in finally after sendPrompt resolves normally', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    store.setState({
      hydrated: true,
      conversationId: 'conv-1',
      isRunning: false,
      isRetryPending: false
    })

    await store.getState().sendPrompt('hello')

    expect(store.getState().isRetryPending).toBe(false)
    expect(store.getState().isRunning).toBe(false)
  })

  it('sets isRetryPending to false in finally even when onRateLimitState set it to true during the run', async () => {
    mockExecuteChatPrompt.mockImplementation(
      (options: {
        onRateLimitState: (s: {
          cooldownUntil: string | undefined
          isRetryPending: boolean
        }) => void
      }) => {
        // Simulate a rate-limit event mid-run that sets isRetryPending: true
        options.onRateLimitState({ cooldownUntil: undefined, isRetryPending: true })
        return Promise.resolve()
      }
    )

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    store.setState({
      hydrated: true,
      conversationId: 'conv-1',
      isRunning: false,
      isRetryPending: false
    })

    await store.getState().sendPrompt('hello')

    // finally block must unconditionally clear both flags
    expect(store.getState().isRetryPending).toBe(false)
    expect(store.getState().isRunning).toBe(false)
  })

  it('sets isRetryPending to false in finally even when sendPrompt throws', async () => {
    mockExecuteChatPrompt.mockRejectedValue(new Error('unexpected'))

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    store.setState({
      hydrated: true,
      conversationId: 'conv-1',
      isRunning: false,
      isRetryPending: true
    })

    // sendPrompt propagates errors but the finally block still runs
    await expect(store.getState().sendPrompt('hello')).rejects.toThrow('unexpected')

    expect(store.getState().isRetryPending).toBe(false)
    expect(store.getState().isRunning).toBe(false)
  })

  it('forwards the configured base URL as the cooldownScope to executeChatPrompt (issue #179)', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore({ litellmBaseUrl: 'https://litellm-b.example.com' })
    })

    store.setState({
      hydrated: true,
      conversationId: 'conv-1',
      isRunning: false,
      isRetryPending: false
    })

    await store.getState().sendPrompt('hello')

    expect(mockExecuteChatPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ cooldownScope: 'https://litellm-b.example.com' })
    )
  })

  it('refreshes cooldownUntil from the new deployment on a base-URL switch (issues #146/#179)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const shell = makeShell()
    shell.preferences = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key === rateLimitCooldownKey('https://litellm-b.example.com') ? future : undefined
        )
      ),
      set: vi.fn(() => Promise.resolve())
    }

    const settingsStore = makeSettingsStore({ litellmBaseUrl: 'https://litellm-a.example.com' })
    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore
    })

    // Switching to a deployment with an active cooldown must surface it.
    settingsStore.setState({ litellmBaseUrl: 'https://litellm-b.example.com' })

    await vi.waitFor(() => {
      expect(store.getState().cooldownUntil).toBe(future)
    })
  })

  it('stop() aborts the active run (Q1)', async () => {
    let capturedSignal: AbortSignal | undefined
    mockExecuteChatPrompt.mockImplementation(
      (options: { signal?: AbortSignal }) =>
        new Promise<void>(() => {
          capturedSignal = options.signal
        })
    )

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    store.setState({ hydrated: true, conversationId: 'conv-1' })

    // Kick off a run that never resolves, then stop it.
    void store.getState().sendPrompt('hello')
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    expect(capturedSignal?.aborted).toBe(false)

    store.getState().stop()
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('rerunLastPrompt() re-runs the latest user prompt as a fresh generation', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    store.setState({
      hydrated: true,
      conversationId: 'conv-1',
      events: [
        { id: 'e1', type: 'user.message', payload: { text: 'first question' } },
        {
          id: 'e2',
          type: 'assistant.done',
          payload: { source: 'an answer', content: { nodes: [] } }
        }
      ] as never
    })

    await store.getState().rerunLastPrompt()

    expect(mockExecuteChatPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'first question' })
    )
  })

  it('rerunLastPrompt() is a no-op when there is no user prompt yet', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    store.setState({ hydrated: true, conversationId: 'conv-1', events: [] })

    await store.getState().rerunLastPrompt()

    expect(mockExecuteChatPrompt).not.toHaveBeenCalled()
  })

  it('does not start a second concurrent run when re-entered during the async window (issue #334)', async () => {
    // executeChatPrompt never resolves, so the first run stays in-flight through
    // the whole test; the second send must be rejected by the synchronous latch.
    let calls = 0
    mockExecuteChatPrompt.mockImplementation(() => {
      calls += 1
      return new Promise<void>(() => {})
    })

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    store.setState({ hydrated: true, conversationId: 'conv-1' })

    // Fire two sends back-to-back without awaiting the first — the race the
    // gate must close (Enter, then Regenerate while the module still loads).
    void store.getState().sendPrompt('first')
    void store.getState().sendPrompt('second')

    await vi.waitFor(() => expect(calls).toBe(1))
    // Give any wrongly-admitted second run a chance to reach executeChatPrompt.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toBe(1)
  })

  it('resetConversation aborts the active run and its late events do not repopulate (issue #332)', async () => {
    let capturedOnEvent: ((event: unknown) => void) | undefined
    let capturedSignal: AbortSignal | undefined
    mockExecuteChatPrompt.mockImplementation(
      (options: { onEvent: (event: unknown) => void; signal?: AbortSignal }) =>
        new Promise<void>(() => {
          capturedOnEvent = options.onEvent
          capturedSignal = options.signal
        })
    )

    const shell = makeShell()
    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    store.setState({ hydrated: true, conversationId: 'conv-1' })

    void store.getState().sendPrompt('hi')
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    expect(capturedSignal?.aborted).toBe(false)

    await store.getState().resetConversation()

    // The run was aborted and the timeline cleared...
    expect(capturedSignal?.aborted).toBe(true)
    expect(store.getState().events).toEqual([])

    // ...and a straggler event from the aborted run must not resurrect anything.
    capturedOnEvent?.({
      id: 'late',
      type: 'assistant.done',
      payload: { source: 'orphan', content: { nodes: [] } }
    })
    expect(store.getState().events).toEqual([])
  })

  it('does not reload the cooldown when an unrelated setting changes', async () => {
    const getPreference = vi.fn(() => Promise.resolve(undefined))
    const shell = makeShell()
    shell.preferences = { get: getPreference, set: vi.fn(() => Promise.resolve()) }
    const settingsStore = makeSettingsStore()
    createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore
    })

    settingsStore.setState({ webSpeechEnabled: false })

    // Give the (unwanted) async reload a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPreference).not.toHaveBeenCalled()
  })
})
