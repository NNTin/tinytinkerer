import {
  canSendPrompt,
  executeChatPrompt,
  initializeChatState,
  resetConversation
} from '@tinytinkerer/app-core'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { createBrowserRuntimeFactory } from '../runtime/get-runtime'
import type { AuthStore } from './auth-store'
import type { SettingsStore } from './settings-store'
import type { StatusStore } from './status-store'

export type ChatState = {
  conversationId: string | undefined
  events: ChatEvent[]
  streamingText: string
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
  const runtimeFactory = createBrowserRuntimeFactory({
    shell: options.shell,
    authStore: options.authStore,
    settingsStore: options.settingsStore,
    statusStore: options.statusStore
  })

  return createStore<ChatState>((set, get) => ({
    conversationId: undefined,
    events: [],
    streamingText: '',
    isRunning: false,
    isRetryPending: false,
    cooldownUntil: undefined,
    initialize: async () => {
      const state = await initializeChatState(options.shell.conversations, options.shell.preferences)
      set(state)
    },
    sendPrompt: async (prompt) => {
      const state = get()
      if (!canSendPrompt(state)) {
        return
      }

      const conversationId = state.conversationId
      if (!conversationId) {
        return
      }

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
          signal: runController.signal,
          onChunk: (text) => {
            set((currentState) => ({
              streamingText: currentState.streamingText + text
            }))
          },
          onEvent: (event) => {
            set((currentState) => ({
              events: [...currentState.events, event],
              streamingText: ''
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
      const events = await resetConversation(options.shell.conversations, get().conversationId)
      set({ events, streamingText: '' })
    }
  }))
}
