import { describe, expect, it } from 'vitest'
import type { InspectorRequestPayload } from '@tinytinkerer/contracts'
import { createInspectorStore, MAX_CAPTURED_REQUESTS } from '../src/stores/inspector-store.js'

const payload = (n: number): InspectorRequestPayload => ({
  model: 'openai/gpt-5',
  stream: true,
  messages: [{ role: 'user', content: `message ${n}` }],
  capturedAt: new Date(n).toISOString()
})

describe('createInspectorStore', () => {
  it('captures requests as pending entries in order', () => {
    const store = createInspectorStore()
    store.getState().capture(payload(1))
    store.getState().capture(payload(2))

    const { entries } = store.getState()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.request.messages[0]?.content).toBe('message 1')
    expect(entries[0]?.response).toEqual({ status: 'pending' })
    expect(entries[1]?.request.messages[0]?.content).toBe('message 2')
  })

  it('attaches a response to the matching entry by id', () => {
    const store = createInspectorStore()
    const id0 = store.getState().capture(payload(0))
    const id1 = store.getState().capture(payload(1))

    store.getState().setResponse(id1, { status: 'ok', httpStatus: 200, content: 'hi' })
    store.getState().setResponse(id0, { status: 'rate_limited', httpStatus: 429 })

    const { entries } = store.getState()
    expect(entries[0]?.response).toEqual({ status: 'rate_limited', httpStatus: 429 })
    expect(entries[1]?.response).toEqual({ status: 'ok', httpStatus: 200, content: 'hi' })
  })

  it('rings the buffer at MAX_CAPTURED_REQUESTS, dropping the oldest', () => {
    const store = createInspectorStore()
    for (let n = 0; n < MAX_CAPTURED_REQUESTS + 5; n += 1) {
      store.getState().capture(payload(n))
    }

    const { entries } = store.getState()
    expect(entries).toHaveLength(MAX_CAPTURED_REQUESTS)
    // Oldest five were dropped; the newest is last.
    expect(entries[0]?.request.messages[0]?.content).toBe('message 5')
    expect(entries.at(-1)?.request.messages[0]?.content).toBe(
      `message ${MAX_CAPTURED_REQUESTS + 4}`
    )
  })

  it('clear() with no id empties the buffer', () => {
    const store = createInspectorStore()
    store.getState().capture(payload(1))
    store.getState().clear()
    expect(store.getState().entries).toEqual([])
  })

  // Multi-conversation scoping (issue #430).
  describe('conversation scoping', () => {
    it('capture tags an entry with the given conversation id, leaving it undefined when omitted', () => {
      const store = createInspectorStore()
      store.getState().capture(payload(1), 'conv-a')
      store.getState().capture(payload(2))

      const { entries } = store.getState()
      expect(entries[0]?.conversationId).toBe('conv-a')
      expect(entries[1]?.conversationId).toBeUndefined()
    })

    it("clear(id) removes only that conversation's entries, leaving others (tagged or not) intact", () => {
      const store = createInspectorStore()
      store.getState().capture(payload(1), 'conv-a')
      store.getState().capture(payload(2), 'conv-b')
      store.getState().capture(payload(3))

      store.getState().clear('conv-a')

      const { entries } = store.getState()
      expect(entries.map((entry) => entry.conversationId)).toEqual(['conv-b', undefined])
    })

    it('clear() with no id still clears everything, including conversation-tagged entries', () => {
      const store = createInspectorStore()
      store.getState().capture(payload(1), 'conv-a')
      store.getState().capture(payload(2), 'conv-b')

      store.getState().clear()

      expect(store.getState().entries).toEqual([])
    })
  })
})
