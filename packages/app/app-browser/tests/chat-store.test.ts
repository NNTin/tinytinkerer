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
    canSendPrompt: mockCanSendPrompt,
  }
})

vi.mock('../src/runtime/get-runtime.js', () => ({
  createBrowserRuntimeFactory: mockCreateBrowserRuntimeFactory,
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
      clearConversationEvents: vi.fn(),
    },
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
    authTokens: {
      getStoredToken: vi.fn(),
      setStoredToken: vi.fn(),
      clearStoredToken: vi.fn(),
      getHostToken: vi.fn(),
    },
    statusGateway: {}
  }) as unknown as BrowserShell

const makeAuthStore = (): AuthStore => ({ getState: vi.fn(() => ({ token: 'tok' })) }) as unknown as AuthStore
// A real zustand store so chat-store's subscribe()/getState() work and tests can
// simulate a base-URL switch via setState.
const makeSettingsStore = (
  initial: { litellmBaseUrl?: string } = {}
): SettingsStore =>
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
      settingsStore: makeSettingsStore(),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: false })

    await store.getState().sendPrompt('hello')

    expect(store.getState().isRetryPending).toBe(false)
    expect(store.getState().isRunning).toBe(false)
  })

  it('sets isRetryPending to false in finally even when onRateLimitState set it to true during the run', async () => {
    mockExecuteChatPrompt.mockImplementation((options: { onRateLimitState: (s: { cooldownUntil: string | undefined; isRetryPending: boolean }) => void }) => {
      // Simulate a rate-limit event mid-run that sets isRetryPending: true
      options.onRateLimitState({ cooldownUntil: undefined, isRetryPending: true })
      return Promise.resolve()
    })

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore(),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: false })

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
      settingsStore: makeSettingsStore(),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: true })

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
      settingsStore: makeSettingsStore({ litellmBaseUrl: 'https://litellm-b.example.com' }),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: false })

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
      set: vi.fn(() => Promise.resolve()),
    }

    const settingsStore = makeSettingsStore({ litellmBaseUrl: 'https://litellm-a.example.com' })
    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore,
    })

    // Switching to a deployment with an active cooldown must surface it.
    settingsStore.setState({ litellmBaseUrl: 'https://litellm-b.example.com' })

    await vi.waitFor(() => {
      expect(store.getState().cooldownUntil).toBe(future)
    })
  })

  it('does not reload the cooldown when an unrelated setting changes', async () => {
    const getPreference = vi.fn(() => Promise.resolve(undefined))
    const shell = makeShell()
    shell.preferences = { get: getPreference, set: vi.fn(() => Promise.resolve()) }
    const settingsStore = makeSettingsStore()
    createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore,
    })

    settingsStore.setState({ webSpeechEnabled: false })

    // Give the (unwanted) async reload a chance to fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPreference).not.toHaveBeenCalled()
  })
})
