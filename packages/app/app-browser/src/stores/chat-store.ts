import type { ChatEvent } from '@tinytinkerer/contracts'
import type { ChatRuntimeFactory, Tool } from '@tinytinkerer/app-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import type { AuthStore } from './auth-store'
import type { SettingsStore } from './settings-store'
import type { InspectorStore } from './inspector-store'
import { resetAllHumanPrompts } from '../human-prompt-bridge'

export type ChatState = {
  hydrated: boolean
  conversationId: string | undefined
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  cooldownUntil: string | undefined
  initialize: () => Promise<void>
  sendPrompt: (prompt: string) => Promise<void>
  // Re-run the latest user prompt as a fresh generation, preserving the existing
  // conversation history. No-op when there is no user turn yet or a run is
  // already in flight (gated by sendPrompt). Backs the "regenerate" action.
  rerunLastPrompt: () => Promise<void>
  cancelRetry: () => void
  // Abort the in-flight generation (the "Stop" affordance). Shares the single
  // abort path with cancelRetry — both signal the same AbortController.
  stop: () => void
  resetConversation: () => Promise<void>
}

export type ChatStore = StoreApi<ChatState>

export const createChatStore = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  // Client-only sink for captured forwarded requests (issue #270). Passed down to
  // the runtime factory, which arms capture only while the inspector plugin is on.
  // Optional so tests can omit it; the app always provides it.
  inspectorStore?: InspectorStore
  // App-local, always-on tools injected by the host app (e.g. a harness shell's
  // app-specific verbs). Forwarded to the runtime factory; absent for
  // web/widget/mobile.
  appTools?: Tool<unknown, unknown>[]
}): ChatStore => {
  let activeRunController: AbortController | undefined
  let initializePromise: Promise<void> | null = null
  let runtimeFactoryPromise: Promise<ChatRuntimeFactory> | null = null
  // Synchronous re-entry latch for sendPrompt (issue #334). isRunning is only
  // set true after sendPrompt's awaits resolve, so it cannot gate a second send
  // that enters during those awaits; this closure flag, set before the first
  // await, can.
  let isSending = false

  // Single abort path shared by `stop` (abort a live run) and `cancelRetry`
  // (abort a queued auto-retry). Keeping one implementation avoids drift between
  // the two affordances.
  const abortActiveRun = () => {
    activeRunController?.abort()
    // Settle every open human prompt (permission allow/deny, choice poll) so a Stop
    // never leaves one hanging until the human-input timeout (issue #85). Generic —
    // names no specific feature. No-op when nothing is pending.
    resetAllHumanPrompts()
  }

  const ensureInitialized = async (set: ChatStore['setState'], get: ChatStore['getState']) => {
    if (get().hydrated) {
      return
    }
    if (initializePromise) {
      return initializePromise
    }

    initializePromise = loadCoreModule()
      .then(async ({ initializeChatState }) => {
        const state = await initializeChatState(
          options.shell.conversations,
          options.shell.preferences,
          // Cooldowns are scoped per LiteLLM deployment (issue #179).
          options.settingsStore.getState().litellmBaseUrl
        )
        set({ ...state, hydrated: true })
      })
      .finally(() => {
        initializePromise = null
      })

    return initializePromise
  }

  const getRuntimeFactory = async (): Promise<ChatRuntimeFactory> => {
    runtimeFactoryPromise ??= (async () => {
      const { createBrowserRuntimeFactory } = await import('../runtime/get-runtime')
      const { loadPluginModules } = await import('../plugins/registry')
      const pluginModules = await loadPluginModules()
      return createBrowserRuntimeFactory({
        shell: options.shell,
        authStore: options.authStore,
        settingsStore: options.settingsStore,
        pluginModules,
        ...(options.appTools ? { appTools: options.appTools } : {}),
        // The runtime arms this only while the inspector plugin is enabled, so a
        // disabled inspector captures (and retains) nothing. Records the request as
        // a pending entry and returns an updater the chokepoint calls with the
        // paired response outcome.
        ...(options.inspectorStore
          ? {
              captureForwardedRequest: (request) => {
                const store = options.inspectorStore
                if (!store) return
                const id = store.getState().capture(request)
                return (response) => store.getState().setResponse(id, response)
              }
            }
          : {})
      })
    })()
    return runtimeFactoryPromise
  }

  const store = createStore<ChatState>((set, get) => ({
    hydrated: false,
    conversationId: undefined,
    events: [],
    isRunning: false,
    isRetryPending: false,
    cooldownUntil: undefined,
    initialize: async () => {
      await ensureInitialized(set, get)
    },
    sendPrompt: async (prompt) => {
      // Gate re-entry synchronously (issue #334): a second send/regenerate that
      // fires while the first is still resolving its awaits (module load, runtime
      // factory) would otherwise read the not-yet-set isRunning flag and start a
      // concurrent run against the same conversation.
      if (isSending || get().isRunning) {
        return
      }
      isSending = true
      try {
        await ensureInitialized(set, get)
        const state = get()
        const { canSendPrompt, executeChatPrompt, appendLiveChatEvent } = await loadCoreModule()
        if (!canSendPrompt(state)) {
          return
        }

        const conversationId = state.conversationId
        if (!conversationId) {
          return
        }

        const runtimeFactory = await getRuntimeFactory()
        const runController = new AbortController()
        activeRunController = runController
        set({ isRunning: true, isRetryPending: false })

        try {
          await executeChatPrompt({
            conversationId,
            existingEvents: get().events,
            prompt,
            runtimeFactory,
            conversations: options.shell.conversations,
            preferences: options.shell.preferences,
            // Cooldowns are scoped per LiteLLM deployment (issue #179).
            cooldownScope: options.settingsStore.getState().litellmBaseUrl,
            signal: runController.signal,
            onEvent: (event) => {
              // Drop events from a run aborted mid-stream (e.g. by a reset) so its
              // tail cannot land on the fresh conversation (issue #332), and
              // collapse live-only stream snapshots so they don't accumulate
              // without bound (issue #339).
              if (runController.signal.aborted) {
                return
              }
              set((currentState) => ({
                events: appendLiveChatEvent(currentState.events, event)
              }))
            },
            onRateLimitState: (rateLimitState) => {
              set(rateLimitState)
            }
          })
        } finally {
          if (activeRunController === runController) {
            activeRunController = undefined
          }

          set({ isRunning: false, isRetryPending: false })
        }
      } finally {
        isSending = false
      }
    },
    rerunLastPrompt: async () => {
      await ensureInitialized(set, get)
      const { latestUserPrompt } = await loadCoreModule()
      const prompt = latestUserPrompt(get().events)
      if (!prompt) {
        return
      }
      // Reuse the normal send path: it re-checks the cooldown/running gate and
      // appends a fresh generation, so history is preserved (issue: regenerate).
      await get().sendPrompt(prompt)
    },
    cancelRetry: () => {
      abortActiveRun()
      set({ isRetryPending: false })
    },
    stop: () => {
      abortActiveRun()
    },
    resetConversation: async () => {
      await ensureInitialized(set, get)
      // Abort any in-flight run BEFORE clearing (issue #332): otherwise the run
      // keeps appending and re-persisting its tail onto the conversation we are
      // about to empty, resurrecting an orphaned assistant turn that survives
      // reload. abortActiveRun also settles every open human prompt (issue #85),
      // which each belong to the conversation being cleared.
      abortActiveRun()
      const { resetConversation } = await loadCoreModule()
      const events = await resetConversation(options.shell.conversations, get().conversationId)
      set({ events })
      // Drop any captured inspector requests too: they belong to the conversation
      // that was just reset, so the developer panel must start empty as well.
      options.inspectorStore?.getState().clear()
    }
  }))

  // Cooldowns are scoped per LiteLLM deployment (issue #179). When the user
  // switches the base URL, reload that deployment's cooldown so send gating
  // reflects it immediately instead of carrying the previous deployment's
  // window (issue #146). The store lives for the app's lifetime, so we never
  // need to unsubscribe.
  options.settingsStore.subscribe((state, prev) => {
    if (state.litellmBaseUrl === prev.litellmBaseUrl) {
      return
    }
    void loadCoreModule().then(async ({ loadCooldown }) => {
      const cooldownUntil = await loadCooldown(options.shell.preferences, state.litellmBaseUrl)
      store.setState({ cooldownUntil })
    })
  })

  return store
}
