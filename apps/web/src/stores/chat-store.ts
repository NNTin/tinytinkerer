import type { ChatEvent } from '@tinytinkerer/types'
import { create } from 'zustand'
import { appendEvent, clearConversationEvents, createConversation, loadConversationEvents } from '../services/db'
import { runtime } from '../services/runtime'
import type { PersistedEvent } from '../types/chat'

type ChatState = {
  conversationId: string | undefined
  events: ChatEvent[]
  isRunning: boolean
  initialize: () => Promise<void>
  sendPrompt: (prompt: string) => Promise<void>
  resetConversation: () => Promise<void>
}

const saveEvent = async (conversationId: string, event: ChatEvent): Promise<void> => {
  const persisted: PersistedEvent = {
    ...event,
    conversationId
  }
  await appendEvent(persisted)
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: undefined,
  events: [],
  isRunning: false,
  initialize: async () => {
    const conversation = await createConversation()
    const storedEvents = await loadConversationEvents(conversation.id)
    set({
      conversationId: conversation.id,
      events: storedEvents
    })
  },
  sendPrompt: async (prompt) => {
    const conversationId = get().conversationId
    if (!conversationId || get().isRunning) {
      return
    }

    set({ isRunning: true })

    for await (const event of runtime.run(prompt)) {
      set((state) => ({ events: [...state.events, event] }))
      await saveEvent(conversationId, event)
    }

    set({ isRunning: false })
  },
  resetConversation: async () => {
    const conversationId = get().conversationId
    if (!conversationId) {
      return
    }

    await clearConversationEvents(conversationId)
    set({ events: [] })
  }
}))
