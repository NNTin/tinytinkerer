import Dexie, { type EntityTable } from 'dexie'
import type {
  AuthTokenStore,
  Conversation,
  ConversationRepository,
  PersistedEvent,
  PreferencesStore
} from '@tinytinkerer/app-core'

type Preference = {
  key: string
  value: string
}

class TinyTinkererDb extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  events!: EntityTable<PersistedEvent, 'id'>
  preferences!: EntityTable<Preference, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      conversations: 'id,updatedAt',
      events: 'id,conversationId,timestamp',
      preferences: 'key'
    })
    this.version(2)
      .stores({
        conversations: 'id,updatedAt',
        events: 'id,conversationId,timestamp',
        preferences: 'key'
      })
      .upgrade(async (tx) => {
        const eventsTable = tx.table('events')
        const existingEvents = await eventsTable.toArray()

        for (const event of existingEvents as Array<Record<string, unknown>>) {
          const eventType = typeof event.type === 'string' ? event.type : ''
          if (!eventType.startsWith('assistant.')) {
            continue
          }

          const payload =
            event.payload && typeof event.payload === 'object'
              ? (event.payload as Record<string, unknown>)
              : null

          if (payload == null) {
            continue
          }

          const hasSource = typeof payload.source === 'string'
          const hasContent = 'content' in payload
          if (hasSource && hasContent) {
            continue
          }

          const source =
            typeof payload.role === 'string'
              ? payload.role
              : typeof payload.kind === 'string'
                ? payload.kind
                : 'assistant'
          const content =
            payload.content ??
            payload.text ??
            payload.delta ??
            payload.message ??
            ''

          await eventsTable.put({
            ...event,
            payload: {
              source,
              content
            }
          })
        }
      })
  }
}

export const createBrowserPersistence = (
  storageNamespace: string,
  hostToken: string | null
): {
  conversations: ConversationRepository
  preferences: PreferencesStore
  authTokens: AuthTokenStore
} => {
  const db = new TinyTinkererDb(storageNamespace)

  const preferences: PreferencesStore = {
    async get(key) {
      const item = await db.preferences.get(key)
      return item?.value
    },
    async set(key, value) {
      await db.preferences.put({ key, value })
    }
  }

  const conversations: ConversationRepository = {
    async createConversation() {
      const now = new Date().toISOString()
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title: 'New conversation',
        createdAt: now,
        updatedAt: now
      }
      await db.conversations.put(conversation)
      return conversation
    },
    async getLatestConversation() {
      return db.conversations.orderBy('updatedAt').last()
    },
    async loadConversationEvents(conversationId) {
      return db.events.where('conversationId').equals(conversationId).sortBy('timestamp')
    },
    async appendEvent(event) {
      await db.events.put(event)
      await db.conversations.update(event.conversationId, { updatedAt: event.timestamp })
    },
    async clearConversationEvents(conversationId) {
      await db.events.where('conversationId').equals(conversationId).delete()
    }
  }

  const authTokens: AuthTokenStore = {
    async getStoredToken() {
      const value = await preferences.get('github_access_token')
      return value || null
    },
    async setStoredToken(token) {
      await preferences.set('github_access_token', token)
    },
    async clearStoredToken() {
      await db.preferences.delete('github_access_token')
    },
    getHostToken() {
      return hostToken
    }
  }

  return { conversations, preferences, authTokens }
}
