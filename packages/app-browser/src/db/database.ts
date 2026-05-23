import Dexie, { type EntityTable } from 'dexie'
import type { Conversation, PersistedEvent } from '@tinytinkerer/app-core'

type Preference = {
  key: string
  value: string
}

export class TinyTinkererDb extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  events!: EntityTable<PersistedEvent, 'id'>
  preferences!: EntityTable<Preference, 'key'>

  constructor(namespace = 'tinytinkerer') {
    super(namespace)
    this.version(1).stores({
      conversations: 'id,updatedAt',
      events: 'id,conversationId,timestamp',
      preferences: 'key'
    })
  }
}

export const createDb = (namespace = 'tinytinkerer'): TinyTinkererDb =>
  new TinyTinkererDb(namespace)
