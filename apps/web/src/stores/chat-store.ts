import type { ChatEvent } from '@tinytinkerer/types'
import { create } from 'zustand'
import {
  appendEvent,
  clearConversationEvents,
  createConversation,
  getPreference,
  loadConversationEvents,
  setPreference
} from '../services/db'
import { runtime } from '../services/runtime'
import type { PersistedEvent } from '../types/chat'

const RATE_LIMIT_COOLDOWN_KEY = 'rate_limit_cooldown_until'

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

const saveEvent = async (conversationId: string, event: ChatEvent): Promise<void> => {
  const persisted: PersistedEvent = {
    ...event,
    conversationId
  }
  await appendEvent(persisted)
}

const activeCooldown = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp) || timestamp <= Date.now()) {
    return undefined
  }

  return value
}

const applyRateLimitEvent = async (event: ChatEvent, set: (state: Partial<ChatState>) => void): Promise<void> => {
  if (event.type === 'rate.limit.waiting') {
    await setPreference(RATE_LIMIT_COOLDOWN_KEY, event.payload.retryAt)
    set({ cooldownUntil: event.payload.retryAt, isRetryPending: event.payload.autoRetry })
    return
  }

  if (event.type === 'rate.limit.cancelled') {
    await setPreference(RATE_LIMIT_COOLDOWN_KEY, event.payload.retryAt)
    set({ cooldownUntil: event.payload.retryAt, isRetryPending: false })
    return
  }

  if (event.type === 'rate.limit.recovered') {
    await setPreference(RATE_LIMIT_COOLDOWN_KEY, '')
    set({ cooldownUntil: undefined, isRetryPending: false })
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: undefined,
  events: [],
  streamingText: '',
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined,
  initialize: async () => {
    const conversation = await createConversation()
    const storedEvents = await loadConversationEvents(conversation.id)
    const cooldownUntil = activeCooldown(await getPreference(RATE_LIMIT_COOLDOWN_KEY))
    if (!cooldownUntil) {
      await setPreference(RATE_LIMIT_COOLDOWN_KEY, '')
    }
    set({
      conversationId: conversation.id,
      events: storedEvents,
      cooldownUntil
    })
  },
  sendPrompt: async (prompt) => {
    const conversationId = get().conversationId
    if (!conversationId || get().isRunning || activeCooldown(get().cooldownUntil)) {
      return
    }

    const runController = new AbortController()
    activeRunController = runController
    set({ isRunning: true, isRetryPending: false })

    try {
      for await (const event of runtime.run(prompt, { signal: runController.signal })) {
        if (event.type === 'assistant.chunk') {
          // Accumulate streaming text without persisting individual chunks or
          // spreading the events array — avoids O(n²) allocations and per-chunk DB writes.
          set((state) => ({ streamingText: state.streamingText + event.payload.text }))
        } else {
          set((state) => ({ events: [...state.events, event], streamingText: '' }))
          await saveEvent(conversationId, event)
          await applyRateLimitEvent(event, set)
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
    const conversationId = get().conversationId
    if (!conversationId) {
      return
    }

    await clearConversationEvents(conversationId)
    set({ events: [], streamingText: '' })
  }
}))
