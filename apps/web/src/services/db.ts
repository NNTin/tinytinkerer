import Dexie, { type EntityTable } from 'dexie'
import type { Conversation, PersistedEvent } from '../types/chat'

type Preference = {
  key: string
  value: string
}

class TinyTinkererDb extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  events!: EntityTable<PersistedEvent, 'id'>
  preferences!: EntityTable<Preference, 'key'>

  constructor() {
    super('tinytinkerer')
    this.version(1).stores({
      conversations: 'id,updatedAt',
      events: 'id,conversationId,timestamp',
      preferences: 'key'
    })
  }
}

export const db = new TinyTinkererDb()

export const createConversation = async (): Promise<Conversation> => {
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
}

export const loadConversationEvents = async (conversationId: string): Promise<PersistedEvent[]> =>
  db.events.where('conversationId').equals(conversationId).sortBy('timestamp')

export const appendEvent = async (event: PersistedEvent): Promise<void> => {
  await db.events.put(event)
  await db.conversations.update(event.conversationId, { updatedAt: event.timestamp })
}

export const clearConversationEvents = async (conversationId: string): Promise<void> => {
  await db.events.where('conversationId').equals(conversationId).delete()
}

export const setPreference = async (key: string, value: string): Promise<void> => {
  await db.preferences.put({ key, value })
}

export const getPreference = async (key: string): Promise<string | undefined> => {
  const item = await db.preferences.get(key)
  return item?.value
}
