import {
  applyRateLimitEvent,
  buildConversationHistory,
  canSendPrompt,
  createPersistedEvent,
  initializeChatState,
  resetConversation
} from '@tinytinkerer/app-core'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { create } from 'zustand'
import { getRuntime } from '../runtime/get-runtime'
import { getBrowserShell } from '../shell'

type ChatState = {
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

let activeRunController: AbortController | undefined

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: undefined,
  events: [],
  streamingText: '',
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined,
  initialize: async () => {
    const state = await initializeChatState(
      getBrowserShell().conversations,
      getBrowserShell().preferences
    )
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
      const history = buildConversationHistory(get().events)
      const runtime = getRuntime()

      for await (const event of runtime.run(prompt, {
        signal: runController.signal,
        history
      })) {
        if (event.type === 'assistant.chunk') {
          set((currentState) => ({
            streamingText: currentState.streamingText + event.payload.text
          }))
          continue
        }

        set((currentState) => ({
          events: [...currentState.events, event],
          streamingText: ''
        }))

        await getBrowserShell().conversations.appendEvent(createPersistedEvent(conversationId, event))

        const rateLimitState = await applyRateLimitEvent(event, getBrowserShell().preferences)
        if (rateLimitState) {
          set(rateLimitState)
        }
      }
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
    const events = await resetConversation(getBrowserShell().conversations, get().conversationId)
    set({ events, streamingText: '' })
  }
}))
