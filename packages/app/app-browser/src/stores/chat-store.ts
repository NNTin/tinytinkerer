import type { ChatEvent } from '@tinytinkerer/contracts'
import type { ChatRuntimeFactory } from '@tinytinkerer/app-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import type { AuthStore } from './auth-store'
import type { SettingsStore } from './settings-store'
import type { StatusStore } from './status-store'

export type ChatState = {
  hydrated: boolean
  conversationId: string | undefined
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  cooldownUntil: string | undefined
  initialize: () => Promise<void>
  sendPrompt: (prompt: string) => Promise<void>
  cancelRetry: () => void
  resetConversation: () => Promise<void>
}

export type ChatStore = StoreApi<ChatState>

export const createChatStore = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  statusStore: StatusStore
}): ChatStore => {
  let activeRunController: AbortController | undefined
  let initializePromise: Promise<void> | null = null
  let runtimeFactoryPromise: Promise<ChatRuntimeFactory> | null = null

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
        statusStore: options.statusStore,
        pluginModules
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
      await ensureInitialized(set, get)
      const state = get()
      const { canSendPrompt, executeChatPrompt } = await loadCoreModule()
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
          litellmBaseUrl: options.settingsStore.getState().litellmBaseUrl,
          signal: runController.signal,
          onEvent: (event) => {
            set((currentState) => ({
              events: [...currentState.events, event]
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
    },
    cancelRetry: () => {
      activeRunController?.abort()
      set({ isRetryPending: false })
    },
    resetConversation: async () => {
      await ensureInitialized(set, get)
      const { resetConversation } = await loadCoreModule()
      const events = await resetConversation(options.shell.conversations, get().conversationId)
      set({ events })
    }
  }))

  return store
}
