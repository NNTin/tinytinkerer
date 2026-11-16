import Dexie, { type EntityTable } from 'dexie'
import {
  compareEventOrder,
  DEFAULT_CONVERSATION_TITLE,
  type AuthTokenStore,
  type Conversation,
  type ConversationRepository,
  type PersistedEvent,
  type PreferencesStore
} from '@tinytinkerer/app-core'
import { assignNodeIds } from '@tinytinkerer/content-react'
import type { RunCheckpoint, RunCheckpointStore } from './runtime/run-checkpoint'

type Preference = {
  key: string
  value: string
}

class TinyTinkererDb extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  events!: EntityTable<PersistedEvent, 'id'>
  preferences!: EntityTable<Preference, 'key'>
  runCheckpoints!: EntityTable<RunCheckpoint, 'conversationId'>

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
          const rawContent =
            payload.content ?? payload.text ?? payload.delta ?? payload.message ?? ''
          // The renderer requires a ContentDocument shape ({ nodes: [...] }).
          // Legacy v1 events stored the assistant text directly as a string;
          // wrap it in a minimal paragraph so the document is at least valid.
          const isStructuredDocument =
            rawContent !== null &&
            typeof rawContent === 'object' &&
            Array.isArray((rawContent as { nodes?: unknown }).nodes)
          const content = isStructuredDocument
            ? rawContent
            : typeof rawContent === 'string' && rawContent.trim().length > 0
              ? // Hand-built document: this repair path is the producer, so it owns
                // normalization (the renderer no longer assigns ids on read).
                assignNodeIds({
                  nodes: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: rawContent }]
                    }
                  ]
                })
              : { nodes: [] }

          await eventsTable.put({
            ...event,
            payload: {
              source,
              content
            }
          })
        }
      })
    this.version(3)
      .stores({
        conversations: 'id,updatedAt',
        events: 'id,conversationId,timestamp',
        preferences: 'key'
      })
      .upgrade(async (tx) => {
        // Repair assistant events whose payload.content is not a structured
        // ContentDocument (e.g. records that the v2 upgrade left as a raw
        // string). Re-wrap them so the renderer doesn't crash on hydration.
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
          const rawContent = payload.content
          const alreadyStructured =
            rawContent !== null &&
            typeof rawContent === 'object' &&
            Array.isArray((rawContent as { nodes?: unknown }).nodes)
          if (alreadyStructured) {
            continue
          }
          const repaired =
            typeof rawContent === 'string' && rawContent.trim().length > 0
              ? // Hand-built document: this repair path is the producer, so it owns
                // normalization (the renderer no longer assigns ids on read).
                assignNodeIds({
                  nodes: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: rawContent }]
                    }
                  ]
                })
              : { nodes: [] }
          await eventsTable.put({
            ...event,
            payload: {
              ...payload,
              content: repaired
            }
          })
        }
      })
    // Saved run progress for explicit Resume (issue #531): at most one record
    // per conversation, removed with the conversation's events. The record's
    // own `version` governs compatibility, independent of this schema version.
    this.version(4).stores({
      conversations: 'id,updatedAt',
      events: 'id,conversationId,timestamp',
      preferences: 'key',
      runCheckpoints: 'conversationId'
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
  runCheckpoints: RunCheckpointStore
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
        title: DEFAULT_CONVERSATION_TITLE,
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
      // Sort with the shared comparator (timestamp, then seq, then id): plain
      // .sortBy('timestamp') left same-millisecond events in random primary-key
      // order, breaking replay (issue #333). sortBy is JS-side anyway, so this
      // needs no schema/version change.
      const events = await db.events.where('conversationId').equals(conversationId).toArray()
      return events.sort(compareEventOrder)
    },
    async appendEvent(event) {
      await db.events.put(event)
      await db.conversations.update(event.conversationId, { updatedAt: event.timestamp })
    },
    async clearConversationEvents(conversationId) {
      // Saved progress first: it must never outlive the turn it continues.
      await db.runCheckpoints.delete(conversationId)
      await db.events.where('conversationId').equals(conversationId).delete()
    },
    async listConversations() {
      // JS-side sort (like loadConversationEvents): conversation counts are
      // small, and Dexie index tricks like .reverse() don't give a stable
      // tie-break on id.
      const all = await db.conversations.toArray()
      return all.sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) {
          return a.updatedAt < b.updatedAt ? 1 : -1
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
    },
    async deleteConversation(conversationId) {
      // Saved progress, then events, so an interruption leaves at worst an
      // empty conversation row (harmless) rather than orphaned data.
      await db.runCheckpoints.delete(conversationId)
      await db.events.where('conversationId').equals(conversationId).delete()
      await db.conversations.delete(conversationId)
    },
    async updateConversationTitle(conversationId, title) {
      await db.conversations.update(conversationId, { title })
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

  // Each write is one read-write transaction: IndexedDB serializes those
  // across every connection to this database, so the owner check and the write
  // are atomic even between tabs (issue #531).
  const runCheckpoints: RunCheckpointStore = {
    get: (conversationId) => db.runCheckpoints.get(conversationId),
    swap: (checkpoint, expectedOwner) =>
      db.transaction('rw', db.runCheckpoints, async () => {
        const current = await db.runCheckpoints.get(checkpoint.conversationId)
        if ((current as { owner?: unknown } | undefined)?.owner !== expectedOwner) return false
        await db.runCheckpoints.put(checkpoint)
        return true
      }),
    delete: (conversationId, expectedOwner) =>
      db.transaction('rw', db.runCheckpoints, async () => {
        const current = await db.runCheckpoints.get(conversationId)
        if (
          expectedOwner !== undefined &&
          current !== undefined &&
          (current as { owner?: unknown }).owner !== expectedOwner
        ) {
          return false
        }
        await db.runCheckpoints.delete(conversationId)
        return true
      })
  }

  return { conversations, preferences, authTokens, runCheckpoints }
}
