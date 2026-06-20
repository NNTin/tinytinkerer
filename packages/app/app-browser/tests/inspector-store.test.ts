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
  it('captures forwarded requests in order', () => {
    const store = createInspectorStore()
    store.getState().capture(payload(1))
    store.getState().capture(payload(2))

    const { requests } = store.getState()
    expect(requests).toHaveLength(2)
    expect(requests[0]?.messages[0]?.content).toBe('message 1')
    expect(requests[1]?.messages[0]?.content).toBe('message 2')
  })

  it('rings the buffer at MAX_CAPTURED_REQUESTS, dropping the oldest', () => {
    const store = createInspectorStore()
    for (let n = 0; n < MAX_CAPTURED_REQUESTS + 5; n += 1) {
      store.getState().capture(payload(n))
    }

    const { requests } = store.getState()
    expect(requests).toHaveLength(MAX_CAPTURED_REQUESTS)
    // Oldest five were dropped; the newest is last.
    expect(requests[0]?.messages[0]?.content).toBe('message 5')
    expect(requests.at(-1)?.messages[0]?.content).toBe(`message ${MAX_CAPTURED_REQUESTS + 4}`)
  })

  it('clear() empties the buffer', () => {
    const store = createInspectorStore()
    store.getState().capture(payload(1))
    store.getState().clear()
    expect(store.getState().requests).toEqual([])
  })
})
