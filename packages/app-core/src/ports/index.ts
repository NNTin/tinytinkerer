import type { ChatEvent } from '@tinytinkerer/contracts'

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type PersistedEvent = ChatEvent & {
  conversationId: string
}

export interface ChatRepository {
  createConversation(): Promise<Conversation>
  getLatestConversation(): Promise<Conversation | undefined>
  getLatestConversationOrCreate(): Promise<Conversation>
  loadConversationEvents(conversationId: string): Promise<PersistedEvent[]>
  appendEvent(event: PersistedEvent): Promise<void>
  clearConversationEvents(conversationId: string): Promise<void>
}

export interface PreferencesRepository {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}
