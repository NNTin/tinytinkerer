import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { BrowserShell } from '../src/shell.js'
import type { AuthStore } from '../src/stores/auth-store.js'
import type { SettingsStore } from '../src/stores/settings-store.js'
import type { StatusStore } from '../src/stores/status-store.js'

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
// simulate a provider switch via setState.
const makeSettingsStore = (
  initial: { selectedModelProvider?: string } = {}
): SettingsStore =>
  createStore(() => ({
    searchEnabled: true,
    selectedModel: 'gpt-4o',
    selectedModelProvider: 'github',
    ...initial
  })) as unknown as SettingsStore
const makeStatusStore = (): StatusStore => ({ getState: vi.fn(() => ({ hydrated: true, status: { auth: { state: 'ready', detail: '' }, models: { state: 'ready', detail: '' }, search: { state: 'ready', detail: '' } } })) }) as unknown as StatusStore

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
      statusStore: makeStatusStore(),
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
      statusStore: makeStatusStore(),
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
      statusStore: makeStatusStore(),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: true })

    // sendPrompt propagates errors but the finally block still runs
    await expect(store.getState().sendPrompt('hello')).rejects.toThrow('unexpected')

    expect(store.getState().isRetryPending).toBe(false)
    expect(store.getState().isRunning).toBe(false)
  })

  it('forwards the selected provider to executeChatPrompt (issue #146)', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore({ selectedModelProvider: 'openrouter' }),
      statusStore: makeStatusStore(),
    })

    store.setState({ hydrated: true, conversationId: 'conv-1', isRunning: false, isRetryPending: false })

    await store.getState().sendPrompt('hello')

    expect(mockExecuteChatPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openrouter' })
    )
  })

  it('refreshes cooldownUntil from the new provider on a provider switch (issue #146)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const shell = makeShell()
    shell.preferences = {
      get: vi.fn((key: string) =>
        Promise.resolve(key.endsWith(':openrouter') ? future : undefined)
      ),
      set: vi.fn(() => Promise.resolve()),
    }

    const settingsStore = makeSettingsStore({ selectedModelProvider: 'github' })
    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore,
      statusStore: makeStatusStore(),
    })

    // Switching to OpenRouter, which has an active cooldown, must surface it.
    settingsStore.setState({ selectedModelProvider: 'openrouter' })

    await vi.waitFor(() => {
      expect(store.getState().cooldownUntil).toBe(future)
    })
  })
})
