import { describe, expect, it, vi } from 'vitest'
import { buildTurns, type PersistedEvent } from '@tinytinkerer/app-core'
import { createBrowserPersistence } from '../src/db'

// In-memory Dexie stand-in (no IndexedDB in this test environment). Tables
// return rows in insertion order, mirroring the nondeterministic primary-key
// tie order that real IndexedDB exposes for same-timestamp events — the sort
// in loadConversationEvents is what must restore determinism (issue #333).
vi.mock('dexie', () => {
  class FakeTable {
    private rows: Array<Record<string, unknown>> = []

    constructor(private readonly keyPath: string) {}

    put(row: Record<string, unknown>) {
      const index = this.rows.findIndex((r) => r[this.keyPath] === row[this.keyPath])
      if (index >= 0) {
        this.rows[index] = row
      } else {
        this.rows.push(row)
      }
      return Promise.resolve()
    }

    get(key: unknown) {
      return Promise.resolve(this.rows.find((row) => row[this.keyPath] === key))
    }

    async update(key: unknown, changes: Record<string, unknown>) {
      const row = await this.get(key)
      if (row) {
        Object.assign(row, changes)
      }
    }

    delete(key: unknown) {
      this.rows = this.rows.filter((row) => row[this.keyPath] !== key)
      return Promise.resolve()
    }

    toArray() {
      return Promise.resolve([...this.rows])
    }

    where(field: string) {
      return {
        equals: (value: unknown) => ({
          toArray: () => Promise.resolve(this.rows.filter((row) => row[field] === value)),
          delete: () => {
            this.rows = this.rows.filter((row) => row[field] !== value)
            return Promise.resolve()
          }
        })
      }
    }

    orderBy(field: string) {
      const sorted = [...this.rows].sort((a, b) => (String(a[field]) < String(b[field]) ? -1 : 1))
      return { last: () => Promise.resolve(sorted.at(-1)) }
    }
  }

  class FakeDexie {
    version() {
      return {
        stores: (defs: Record<string, string>) => {
          const self = this as unknown as Record<string, unknown>
          for (const [table, def] of Object.entries(defs)) {
            if (!self[table]) {
              self[table] = new FakeTable(def.split(',')[0]!)
            }
          }
          return { upgrade: () => undefined }
        }
      }
    }
  }

  return { default: FakeDexie }
})

const toolEvent = (
  conversationId: string,
  id: string,
  timestamp: string,
  seq: number,
  type: 'agent.tool.started' | 'agent.tool.completed'
): PersistedEvent =>
  ({
    conversationId,
    id,
    timestamp,
    seq,
    type,
    payload:
      type === 'agent.tool.started'
        ? { stepId: 'act-1', toolId: 'web-search', input: { query: 'hi' } }
        : { stepId: 'act-1', toolId: 'web-search', output: { results: [] } }
  }) as PersistedEvent

describe('createBrowserPersistence conversations', () => {
  it('replays same-millisecond events in seq order even when persisted adversely (#333)', async () => {
    const { conversations } = createBrowserPersistence('test-db', null)
    const conversation = await conversations.createConversation()
    const timestamp = '2026-07-05T00:00:00.000Z'

    const user: PersistedEvent = {
      conversationId: conversation.id,
      id: 'evt-user',
      timestamp,
      seq: 0,
      type: 'user.message',
      payload: { text: 'hi' }
    }
    const started = toolEvent(conversation.id, 'evt-started', timestamp, 1, 'agent.tool.started')
    const completed = toolEvent(
      conversation.id,
      'evt-completed',
      timestamp,
      2,
      'agent.tool.completed'
    )

    // Adverse persistence order: completed lands before its started sibling.
    await conversations.appendEvent(completed)
    await conversations.appendEvent(started)
    await conversations.appendEvent(user)
    // An unrelated conversation's event must not leak into the load.
    await conversations.appendEvent(
      toolEvent('other-conversation', 'evt-other', timestamp, 0, 'agent.tool.started')
    )

    const loaded = await conversations.loadConversationEvents(conversation.id)

    expect(loaded.map((event) => event.id)).toEqual(['evt-user', 'evt-started', 'evt-completed'])

    // The projections consumer sees a single finished tool, not one stuck 'started'.
    const turns = buildTurns(loaded)
    expect(turns).toHaveLength(1)
    const tools = turns[0]?.activity.items.filter((item) => item.kind === 'tool') ?? []
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolId: 'web-search', status: 'completed' })
  })

  it('lists conversations most-recently-updated first, tie-breaking by id', async () => {
    const { conversations } = createBrowserPersistence('test-db', null)
    const a = await conversations.createConversation()
    const b = await conversations.createConversation()
    const c = await conversations.createConversation()

    // Two conversations share the same updatedAt to exercise the tie-break.
    await conversations.appendEvent({
      conversationId: a.id,
      id: 'evt-a',
      timestamp: '2026-07-05T00:00:01.000Z',
      seq: 0,
      type: 'user.message',
      payload: { text: 'a' }
    })
    await conversations.appendEvent({
      conversationId: b.id,
      id: 'evt-b',
      timestamp: '2026-07-05T00:00:02.000Z',
      seq: 0,
      type: 'user.message',
      payload: { text: 'b' }
    })
    await conversations.appendEvent({
      conversationId: c.id,
      id: 'evt-c',
      timestamp: '2026-07-05T00:00:02.000Z',
      seq: 0,
      type: 'user.message',
      payload: { text: 'c' }
    })

    const [tieFirst, tieSecond] = b.id < c.id ? [b, c] : [c, b]
    const listed = await conversations.listConversations()

    expect(listed.map((conversation) => conversation.id)).toEqual([tieFirst.id, tieSecond.id, a.id])
  })

  it('deletes a conversation and only its own events', async () => {
    const { conversations } = createBrowserPersistence('test-db', null)
    const keep = await conversations.createConversation()
    const remove = await conversations.createConversation()

    await conversations.appendEvent({
      conversationId: keep.id,
      id: 'evt-keep',
      timestamp: '2026-07-05T00:00:00.000Z',
      seq: 0,
      type: 'user.message',
      payload: { text: 'keep' }
    })
    await conversations.appendEvent({
      conversationId: remove.id,
      id: 'evt-remove',
      timestamp: '2026-07-05T00:00:00.000Z',
      seq: 0,
      type: 'user.message',
      payload: { text: 'remove' }
    })

    await conversations.deleteConversation(remove.id)

    const remaining = await conversations.listConversations()
    expect(remaining.map((conversation) => conversation.id)).toEqual([keep.id])
    expect(await conversations.loadConversationEvents(remove.id)).toEqual([])
    expect(await conversations.loadConversationEvents(keep.id)).toHaveLength(1)

    // Deleting an unknown id is a no-op.
    await expect(conversations.deleteConversation('missing')).resolves.toBeUndefined()
  })

  it('updates a conversation title without touching updatedAt', async () => {
    const { conversations } = createBrowserPersistence('test-db', null)
    const conversation = await conversations.createConversation()

    await conversations.updateConversationTitle(conversation.id, 'Renamed')

    const [listed] = await conversations.listConversations()
    expect(listed?.title).toBe('Renamed')
    expect(listed?.updatedAt).toBe(conversation.updatedAt)

    // Updating an unknown id is a no-op.
    await expect(conversations.updateConversationTitle('missing', 'Nope')).resolves.toBeUndefined()
  })
})
