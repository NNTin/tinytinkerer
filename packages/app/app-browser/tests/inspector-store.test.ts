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

  it('clear() empties the buffer', () => {
    const store = createInspectorStore()
    store.getState().capture(payload(1))
    store.getState().clear()
    expect(store.getState().entries).toEqual([])
  })
})
