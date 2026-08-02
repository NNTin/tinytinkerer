import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { ChatEvent, HumanPromptView, InspectorRequestPayload } from '@tinytinkerer/contracts'
import type { BrowserShell } from '../src/shell.js'
import type { AuthStore } from '../src/stores/auth-store.js'
import type { SettingsStore } from '../src/stores/settings-store.js'
import type { PersistedEvent } from '@tinytinkerer/app-core'
import type { ChatStore, ConversationSlice } from '../src/stores/chat-store.js'
import { createInspectorStore } from '../src/stores/inspector-store.js'
import { requestHumanInput, resetHumanPrompts } from '../src/human-prompt-bridge.js'

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

const { createChatStore, MAX_CONCURRENT_RUNS } = await import('../src/stores/chat-store.js')
const { ACTIVE_CONVERSATION_KEY, rateLimitCooldownKey } = await import('@tinytinkerer/app-core')

const conversationRow = (id: string) => ({
  id,
  title: 'New conversation',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z'
})

const makeShell = (): BrowserShell =>
  ({
    config: {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      authMode: 'hybrid',
      hostToken: null
    },
    conversations: {
      createConversation: vi.fn(() => Promise.resolve(conversationRow('created-1'))),
      getLatestConversation: vi.fn(() => Promise.resolve(undefined)),
      loadConversationEvents: vi.fn(() => Promise.resolve([])),
      appendEvent: vi.fn(() => Promise.resolve()),
      clearConversationEvents: vi.fn(() => Promise.resolve()),
      listConversations: vi.fn(() => Promise.resolve([])),
      deleteConversation: vi.fn(() => Promise.resolve()),
      updateConversationTitle: vi.fn(() => Promise.resolve())
    },
    preferences: {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve())
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

// Seed hydrated multi-conversation state directly, bypassing initialize() (the
// initialization path has its own tests below). The first id is active unless
// overridden; every slice starts idle and already loaded unless specified.
const seedConversations = (
  store: ChatStore,
  slices: { id: string; events?: ChatEvent[]; eventsLoaded?: boolean }[],
  activeId = slices[0]?.id
) => {
  const conversations = Object.fromEntries(
    slices.map((slice) => [
      slice.id,
      {
        id: slice.id,
        title: 'New conversation',
        events: slice.events ?? [],
        isRunning: false,
        isRetryPending: false,
        eventsLoaded: slice.eventsLoaded ?? true
      } satisfies ConversationSlice
    ])
  )
  store.setState({
    hydrated: true,
    conversationId: activeId,
    conversations,
    conversationOrder: slices.map((slice) => slice.id),
    events: (activeId ? conversations[activeId]?.events : undefined) ?? [],
    isRunning: false,
    isRetryPending: false
  })
}

type CapturedRun = {
  conversationId: string
  signal?: AbortSignal
  onEvent: (event: unknown) => void
}

// executeChatPrompt never resolves, so every started run stays in flight for
// the whole test while its options (target, signal, onEvent) are captured.
const captureRuns = (): CapturedRun[] => {
  const captured: CapturedRun[] = []
  mockExecuteChatPrompt.mockImplementation(
    (options: CapturedRun) =>
      new Promise<void>(() => {
        captured.push(options)
      })
  )
  return captured
}

const userMessage = (id: string, text: string) =>
  ({ id, type: 'user.message', payload: { text } }) as unknown as ChatEvent

const persistedMessage = (id: string, text: string, conversationId: string) =>
  ({ id, type: 'user.message', payload: { text }, conversationId }) as unknown as PersistedEvent

beforeEach(() => {
  vi.clearAllMocks()
  mockCanSendPrompt.mockReturnValue(true)
})

afterEach(() => {
  // The human-prompt bridge is a real module-level singleton (issue #430 tests
  // below use it directly); settle anything a failed assertion left pending so
  // it cannot leak into a later test.
  resetHumanPrompts()
})

const humanPromptView: HumanPromptView = {
  role: 'alertdialog',
  ariaLabel: 'Tool permission request',
  title: 'Allow this tool to run?',
  actions: [
    { id: 'deny', label: 'Deny' },
    { id: 'allow', label: 'Allow', tone: 'primary' }
  ],
  dismissLabel: 'Deny tool'
}

const inspectorPayload = (model: string): InspectorRequestPayload => ({
  model,
  stream: true,
  messages: [{ role: 'user', content: 'hi' }],
  capturedAt: new Date().toISOString()
})

describe('createChatStore', () => {
  it('sets isRetryPending to false in finally after sendPrompt resolves normally', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    seedConversations(store, [{ id: 'conv-1' }])

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

    seedConversations(store, [{ id: 'conv-1' }])

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

    seedConversations(store, [{ id: 'conv-1' }])
    store.setState({ isRetryPending: true })

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

    seedConversations(store, [{ id: 'conv-1' }])

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
    seedConversations(store, [{ id: 'conv-1' }])

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
    seedConversations(store, [
      {
        id: 'conv-1',
        events: [
          { id: 'e1', type: 'user.message', payload: { text: 'first question' } },
          {
            id: 'e2',
            type: 'assistant.done',
            payload: { source: 'an answer', content: { nodes: [] } }
          }
        ] as never
      }
    ])

    await store.getState().rerunLastPrompt()

    expect(mockExecuteChatPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'first question' })
    )
  })

  // The outbound-send coordinator (issue #481 review, finding 1).
  //
  // The gate used to live only in the composer, which made "the composer checks
  // it" quietly different from "this app cannot send unacknowledged": Regenerate
  // reaches `sendPrompt` directly, so a reader with persisted history and no
  // acknowledgement could send the whole conversation without ever seeing the
  // disclosure. These pin the check at the call every send shares.
  describe('outbound send gate', () => {
    const conversationWithHistory = [
      {
        id: 'conv-1',
        events: [
          { id: 'e1', type: 'user.message', payload: { text: 'first question' } },
          {
            id: 'e2',
            type: 'assistant.done',
            payload: { source: 'an answer', content: { nodes: [] } }
          }
        ] as never
      }
    ]

    it('sends nothing — not even a regenerate — while approval is withheld', async () => {
      mockExecuteChatPrompt.mockResolvedValue(undefined)
      const outboundSendGate = vi.fn(() => Promise.resolve(false))
      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore(),
        outboundSendGate
      })
      seedConversations(store, conversationWithHistory)

      await store.getState().rerunLastPrompt()
      await store.getState().sendPrompt('a new question')

      expect(outboundSendGate).toHaveBeenCalledTimes(2)
      expect(mockExecuteChatPrompt).not.toHaveBeenCalled()
    })

    it('lets a regenerate through once approval is given', async () => {
      mockExecuteChatPrompt.mockResolvedValue(undefined)
      const outboundSendGate = vi.fn(() => Promise.resolve(true))
      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore(),
        outboundSendGate
      })
      seedConversations(store, conversationWithHistory)

      await store.getState().rerunLastPrompt()

      // Asked about the prompt it was actually going to send, so a disclosure
      // could show it if it ever wanted to.
      expect(outboundSendGate).toHaveBeenCalledWith('first question')
      expect(mockExecuteChatPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'first question' })
      )
    })

    it('is absent for an app that declares no disclosure', async () => {
      // Every product app today. The store must not require one.
      mockExecuteChatPrompt.mockResolvedValue(undefined)
      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore()
      })
      seedConversations(store, [{ id: 'conv-1' }])

      await store.getState().sendPrompt('hello')

      expect(mockExecuteChatPrompt).toHaveBeenCalled()
    })
  })

  it('rerunLastPrompt() is a no-op when there is no user prompt yet', async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)

    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'conv-1' }])

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
    seedConversations(store, [{ id: 'conv-1' }])

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
    seedConversations(store, [{ id: 'conv-1' }])

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

  it('keeps a background run streaming into its own slice across a switch (issue #430)', async () => {
    const runs = captureRuns()
    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    void store.getState().sendPrompt('into a')
    await vi.waitFor(() => expect(runs).toHaveLength(1))

    await store.getState().selectConversation('b')
    expect(store.getState().conversationId).toBe('b')
    expect(store.getState().isRunning).toBe(false)

    // The run keeps streaming into A's slice while B is displayed.
    const streamed = userMessage('e-a', 'landed in a')
    runs[0]?.onEvent(streamed)
    expect(store.getState().events).toEqual([])
    expect(store.getState().conversations.a?.events).toEqual([streamed])
    expect(store.getState().conversations.a?.isRunning).toBe(true)

    // Selecting A again surfaces its accumulated events and running state.
    await store.getState().selectConversation('a')
    expect(store.getState().events).toEqual([streamed])
    expect(store.getState().isRunning).toBe(true)
  })

  it('resetConversation aborts only the target conversation and leaves others running (issue #332, per conversation)', async () => {
    const runs = captureRuns()
    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    void store.getState().sendPrompt('into a')
    void store.getState().sendPrompt('into b', 'b')
    await vi.waitFor(() => expect(runs).toHaveLength(2))

    await store.getState().resetConversation('a')

    const runA = runs.find((run) => run.conversationId === 'a')
    const runB = runs.find((run) => run.conversationId === 'b')
    expect(runA?.signal?.aborted).toBe(true)
    expect(runB?.signal?.aborted).toBe(false)

    // A's aborted tail must not land...
    runA?.onEvent(userMessage('late-a', 'orphan'))
    expect(store.getState().conversations.a?.events).toEqual([])

    // ...while B keeps streaming into its own intact slice.
    const streamedB = userMessage('e-b', 'still running')
    runB?.onEvent(streamedB)
    expect(store.getState().conversations.b?.events).toEqual([streamedB])
    expect(store.getState().conversations.b?.isRunning).toBe(true)
  })

  it('latches per conversation: a same-conversation double-send runs once, different conversations run concurrently (issue #334)', async () => {
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
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    // Two synchronous sends into the same conversation → one run.
    void store.getState().sendPrompt('first', 'a')
    void store.getState().sendPrompt('second', 'a')
    await vi.waitFor(() => expect(calls).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toBe(1)

    // A send into a different conversation starts an independent run.
    void store.getState().sendPrompt('third', 'b')
    await vi.waitFor(() => expect(calls).toBe(2))
  })

  it('silently refuses a send that would exceed MAX_CONCURRENT_RUNS', async () => {
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
    seedConversations(store, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])

    void store.getState().sendPrompt('one', 'a')
    void store.getState().sendPrompt('two', 'b')
    void store.getState().sendPrompt('three', 'c')
    await vi.waitFor(() => expect(calls).toBe(MAX_CONCURRENT_RUNS))

    // The fourth conversation's send no-ops without starting a run.
    await store.getState().sendPrompt('overflow', 'd')
    expect(calls).toBe(MAX_CONCURRENT_RUNS)
    expect(store.getState().conversations.d?.isRunning).toBe(false)
  })

  describe('canStartRun (issue #430)', () => {
    it('mirrors sendPrompt: true with no runs in flight, false for a latched conversation, true for another', async () => {
      captureRuns()

      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore()
      })
      seedConversations(store, [{ id: 'a' }, { id: 'b' }])

      expect(store.getState().canStartRun('a')).toBe(true)
      expect(store.getState().canStartRun('b')).toBe(true)

      void store.getState().sendPrompt('hello', 'a')
      await vi.waitFor(() => expect(store.getState().conversations.a?.isRunning).toBe(true))

      // 'a' is now latched (running); 'b' is untouched.
      expect(store.getState().canStartRun('a')).toBe(false)
      expect(store.getState().canStartRun('b')).toBe(true)
    })

    it('defaults to the active conversation when no id is passed', async () => {
      captureRuns()

      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore()
      })
      seedConversations(store, [{ id: 'a' }, { id: 'b' }], 'a')

      expect(store.getState().canStartRun()).toBe(true)

      void store.getState().sendPrompt('hello', 'a')
      await vi.waitFor(() => expect(store.getState().conversations.a?.isRunning).toBe(true))

      expect(store.getState().canStartRun()).toBe(false)
    })

    it('returns false for a conversation that would exceed MAX_CONCURRENT_RUNS, true for the ones already running', async () => {
      captureRuns()

      const store = createChatStore({
        shell: makeShell(),
        authStore: makeAuthStore(),
        settingsStore: makeSettingsStore()
      })
      seedConversations(store, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])

      void store.getState().sendPrompt('one', 'a')
      void store.getState().sendPrompt('two', 'b')
      void store.getState().sendPrompt('three', 'c')
      await vi.waitFor(() =>
        expect(['a', 'b', 'c'].every((id) => store.getState().conversations[id]?.isRunning)).toBe(
          true
        )
      )

      // The cap is already met by a/b/c; 'd' would exceed it.
      expect(store.getState().canStartRun('d')).toBe(false)
      // A latched (running) conversation refuses a re-send of itself too.
      expect(store.getState().canStartRun('a')).toBe(false)
    })
  })

  it('selectConversation hydrates events from the repository exactly once', async () => {
    const shell = makeShell()
    const persisted = [persistedMessage('p1', 'from an earlier session', 'b')]
    const loadConversationEvents = vi.fn(() => Promise.resolve(persisted))
    shell.conversations.loadConversationEvents = loadConversationEvents

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b', eventsLoaded: false }])

    await store.getState().selectConversation('b')
    expect(loadConversationEvents).toHaveBeenCalledTimes(1)
    expect(loadConversationEvents).toHaveBeenCalledWith('b')
    expect(store.getState().conversationId).toBe('b')
    expect(store.getState().events).toEqual(persisted)

    // A second activation reuses the already-loaded slice.
    await store.getState().selectConversation('a')
    await store.getState().selectConversation('b')
    expect(loadConversationEvents).toHaveBeenCalledTimes(1)
    expect(store.getState().events).toEqual(persisted)
  })

  it('persists the active conversation id on select and create', async () => {
    const shell = makeShell()
    shell.conversations.createConversation = vi.fn(() => Promise.resolve(conversationRow('fresh')))
    const setPreference = vi.fn(() => Promise.resolve())
    shell.preferences = { get: vi.fn(() => Promise.resolve(undefined)), set: setPreference }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    await store.getState().selectConversation('b')
    expect(setPreference).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'b')

    await store.getState().startNewConversation()
    expect(setPreference).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'fresh')
    expect(store.getState().conversationId).toBe('fresh')
    expect(store.getState().conversationOrder).toEqual(['fresh', 'a', 'b'])
    expect(store.getState().events).toEqual([])
  })

  it('deleteConversation aborts the running active target and activates the most recent remaining', async () => {
    const runs = captureRuns()
    const shell = makeShell()
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation
    const setPreference = vi.fn(() => Promise.resolve())
    shell.preferences = { get: vi.fn(() => Promise.resolve(undefined)), set: setPreference }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    void store.getState().sendPrompt('into a')
    await vi.waitFor(() => expect(runs).toHaveLength(1))

    await store.getState().deleteConversation('a')

    expect(runs[0]?.signal?.aborted).toBe(true)
    expect(deleteConversation).toHaveBeenCalledWith('a')
    expect(store.getState().conversations.a).toBeUndefined()
    expect(store.getState().conversationOrder).toEqual(['b'])
    expect(store.getState().conversationId).toBe('b')
    expect(setPreference).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'b')
  })

  it('deleteConversation of the last conversation creates a fresh one', async () => {
    const shell = makeShell()
    const createConversation = vi.fn(() => Promise.resolve(conversationRow('fresh')))
    shell.conversations.createConversation = createConversation
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation
    const setPreference = vi.fn(() => Promise.resolve())
    shell.preferences = { get: vi.fn(() => Promise.resolve(undefined)), set: setPreference }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }])

    await store.getState().deleteConversation('a')

    expect(deleteConversation).toHaveBeenCalledWith('a')
    expect(createConversation).toHaveBeenCalledTimes(1)
    expect(store.getState().conversationId).toBe('fresh')
    expect(store.getState().conversationOrder).toEqual(['fresh'])
    expect(setPreference).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'fresh')
  })

  // The docs assistant's reset (issue #479): a fresh conversation, not the same
  // one emptied in place, and not delete-then-create from a caller — deleting the
  // ACTIVE conversation already activates the most recent remaining one, so a
  // composite would briefly select an unrelated conversation and could leave two
  // new ones behind.
  it('restartConversation aborts the active run, discards it, and selects a fresh one', async () => {
    const runs = captureRuns()
    const shell = makeShell()
    const createConversation = vi.fn(() => Promise.resolve(conversationRow('fresh')))
    shell.conversations.createConversation = createConversation
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation
    const setPreference = vi.fn(() => Promise.resolve())
    shell.preferences = { get: vi.fn(() => Promise.resolve(undefined)), set: setPreference }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    void store.getState().sendPrompt('into a')
    await vi.waitFor(() => expect(runs).toHaveLength(1))

    await store.getState().restartConversation()

    expect(runs[0]?.signal?.aborted).toBe(true)
    expect(deleteConversation).toHaveBeenCalledWith('a')
    expect(createConversation).toHaveBeenCalledTimes(1)
    expect(store.getState().conversationId).toBe('fresh')
    // The other conversation is untouched, and the discarded one never becomes
    // active on the way through.
    expect(store.getState().conversationOrder).toEqual(['fresh', 'b'])
    expect(store.getState().conversations.a).toBeUndefined()
    expect(store.getState().conversations.b).toBeDefined()
    expect(setPreference).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'fresh')
  })

  it('restartConversation targets a named conversation and leaves the active one alone', async () => {
    const shell = makeShell()
    shell.conversations.createConversation = vi.fn(() => Promise.resolve(conversationRow('fresh')))
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation
    shell.preferences = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve())
    }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    await store.getState().restartConversation('b')

    expect(deleteConversation).toHaveBeenCalledWith('b')
    expect(store.getState().conversations.b).toBeUndefined()
    expect(store.getState().conversations.a).toBeDefined()
    // Creating the fresh conversation makes it active, as it does everywhere else.
    expect(store.getState().conversationId).toBe('fresh')
  })

  it('restartConversation still yields a conversation when the id is unknown', async () => {
    const shell = makeShell()
    shell.conversations.createConversation = vi.fn(() => Promise.resolve(conversationRow('fresh')))
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation
    shell.preferences = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve())
    }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }])

    await store.getState().restartConversation('missing')

    // Nothing was deleted, but the chat always has a conversation.
    expect(deleteConversation).not.toHaveBeenCalled()
    expect(store.getState().conversationId).toBe('fresh')
    expect(store.getState().conversations.a).toBeDefined()
  })

  it('deleteConversation is a no-op for an unknown id', async () => {
    const shell = makeShell()
    const deleteConversation = vi.fn(() => Promise.resolve())
    shell.conversations.deleteConversation = deleteConversation

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }])

    await store.getState().deleteConversation('ghost')

    expect(deleteConversation).not.toHaveBeenCalled()
    expect(store.getState().conversationId).toBe('a')
    expect(store.getState().conversationOrder).toEqual(['a'])
  })

  it('initialize restores a valid stored active conversation id', async () => {
    const shell = makeShell()
    const persisted = [persistedMessage('p1', 'restored', 'older')]
    shell.conversations.listConversations = vi.fn(() =>
      Promise.resolve([conversationRow('newest'), conversationRow('older')])
    )
    const loadConversationEvents = vi.fn((id: string) =>
      Promise.resolve(id === 'older' ? persisted : [])
    )
    shell.conversations.loadConversationEvents = loadConversationEvents
    shell.preferences = {
      get: vi.fn((key: string) =>
        Promise.resolve(key === ACTIVE_CONVERSATION_KEY ? 'older' : undefined)
      ),
      set: vi.fn(() => Promise.resolve())
    }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    await store.getState().initialize()

    expect(store.getState().conversationId).toBe('older')
    expect(store.getState().events).toEqual(persisted)
    expect(store.getState().conversationOrder).toEqual(['newest', 'older'])
    // Only the active conversation's events were loaded.
    expect(loadConversationEvents).toHaveBeenCalledTimes(1)
    expect(store.getState().conversations.newest?.eventsLoaded).toBe(false)
  })

  it('initialize falls back to the most recent conversation for a stale stored id', async () => {
    const shell = makeShell()
    shell.conversations.listConversations = vi.fn(() =>
      Promise.resolve([conversationRow('newest'), conversationRow('older')])
    )
    shell.preferences = {
      get: vi.fn((key: string) =>
        Promise.resolve(key === ACTIVE_CONVERSATION_KEY ? 'deleted-long-ago' : undefined)
      ),
      set: vi.fn(() => Promise.resolve())
    }

    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })

    await store.getState().initialize()

    expect(store.getState().conversationId).toBe('newest')
  })

  it("resetConversation settles only the target conversation's human prompts, leaving another conversation's pending (issue #430)", async () => {
    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore()
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    const promptA = requestHumanInput(humanPromptView, 'a')
    const promptB = requestHumanInput(humanPromptView, 'b')

    await store.getState().resetConversation('a')

    await expect(promptA).resolves.toEqual({ kind: 'dismissed' })

    // B must still be pending: race it against an already-resolved sentinel —
    // the sentinel wins iff B has not settled.
    const pendingSentinel = Symbol('pending')
    const raced = await Promise.race([promptB, Promise.resolve(pendingSentinel)])
    expect(raced).toBe(pendingSentinel)
  })

  it("resetConversation clears only the target conversation's captured inspector entries (issue #430)", async () => {
    mockExecuteChatPrompt.mockResolvedValue(undefined)
    const inspectorStore = createInspectorStore()
    const store = createChatStore({
      shell: makeShell(),
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore(),
      inspectorStore
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    inspectorStore.getState().capture(inspectorPayload('model-a'), 'a')
    inspectorStore.getState().capture(inspectorPayload('model-b'), 'b')

    await store.getState().resetConversation('a')

    const remaining = inspectorStore.getState().entries
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.conversationId).toBe('b')
  })

  it("deleteConversation clears the deleted conversation's captured inspector entries (issue #430)", async () => {
    const inspectorStore = createInspectorStore()
    const shell = makeShell()
    shell.conversations.deleteConversation = vi.fn(() => Promise.resolve())
    const store = createChatStore({
      shell,
      authStore: makeAuthStore(),
      settingsStore: makeSettingsStore(),
      inspectorStore
    })
    seedConversations(store, [{ id: 'a' }, { id: 'b' }])

    inspectorStore.getState().capture(inspectorPayload('model-a'), 'a')
    inspectorStore.getState().capture(inspectorPayload('model-b'), 'b')

    await store.getState().deleteConversation('a')

    const remaining = inspectorStore.getState().entries
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.conversationId).toBe('b')
  })
})
