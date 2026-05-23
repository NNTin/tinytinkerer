import type { Conversation, PersistedEvent } from '@tinytinkerer/app-core'
import type { TinyTinkererDb } from './database.js'

export const createChatRepository = (db: TinyTinkererDb) => ({
  async createConversation(): Promise<Conversation> {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const conversation: Conversation = {
      id,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now
    }
    await db.conversations.put(conversation)
    return conversation
  },

  async getLatestConversation(): Promise<Conversation | undefined> {
    return db.conversations.orderBy('updatedAt').last()
  },

  async getLatestConversationOrCreate(): Promise<Conversation> {
    return (await db.conversations.orderBy('updatedAt').last()) ?? this.createConversation()
  },

  async loadConversationEvents(conversationId: string): Promise<PersistedEvent[]> {
    return db.events.where('conversationId').equals(conversationId).sortBy('timestamp')
  },

  async appendEvent(event: PersistedEvent): Promise<void> {
    await db.events.put(event)
    await db.conversations.update(event.conversationId, { updatedAt: event.timestamp })
  },

  async clearConversationEvents(conversationId: string): Promise<void> {
    await db.events.where('conversationId').equals(conversationId).delete()
  }
})

export const createPreferencesRepository = (db: TinyTinkererDb) => ({
  async get(key: string): Promise<string | undefined> {
    const item = await db.preferences.get(key)
    return item?.value
  },

  async set(key: string, value: string): Promise<void> {
    await db.preferences.put({ key, value })
  }
})
