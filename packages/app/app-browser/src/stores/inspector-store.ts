import type {
  InspectorEntry,
  InspectorRequestPayload,
  InspectorResponse
} from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

// Bound on retained captures (issue #270, decision #4). Each entry carries the
// full forwarded context (system prompt + history + tool observations) plus the
// response, so this is a ring buffer rather than an unbounded log: a turn issues
// several model calls (decide → synthesize, etc.), so ~20 keeps the last several
// turns without growing memory unboundedly. Live-only — never persisted, never
// serialized to telemetry.
export const MAX_CAPTURED_REQUESTS = 20

// A captured entry plus a stable host-internal id, so the response can be filled
// in after the request resolves even as the ring buffer drops older entries (which
// shifts array indices). The id is not part of the contract — the plugin mapper
// only sees the `request`/`response` fields it needs. `conversationId` tags which
// conversation's run captured it (issue #430); absent for a capture with no
// conversation scope (e.g. a pre-multi-conversation caller).
export type StoredInspectorEntry = InspectorEntry & { id: number; conversationId?: string }

export type InspectorState = {
  entries: StoredInspectorEntry[]
  // Records a forwarded request as a `pending` entry, tagged with the run's
  // conversation id when known, and returns its id so the caller can attach the
  // response when it resolves.
  capture: (request: InspectorRequestPayload, conversationId?: string) => number
  setResponse: (id: number, response: InspectorResponse) => void
  // Removes entries whose `conversationId` matches (a per-conversation reset or
  // delete, issue #430); `undefined` clears everything, preserving every caller
  // that predates scoping.
  clear: (conversationId?: string) => void
}

export type InspectorStore = StoreApi<InspectorState>

// A client-only, in-memory store for captured request+response entries. It is
// created for every browser app but only ever written to while the inspector
// plugin is enabled (the runtime injects the capture sink off that activation
// state) and only ever read by the web app's inspector panel. It deliberately uses
// no persistence middleware so the heavy conversation payload never reaches disk.
export const createInspectorStore = (): InspectorStore => {
  let nextId = 0
  return createStore<InspectorState>((set) => ({
    entries: [],
    capture: (request, conversationId) => {
      const id = nextId
      nextId += 1
      set((state) => {
        const next: StoredInspectorEntry[] = [
          ...state.entries,
          {
            id,
            request,
            response: { status: 'pending' },
            ...(conversationId !== undefined ? { conversationId } : {})
          }
        ]
        return {
          entries: next.length > MAX_CAPTURED_REQUESTS ? next.slice(-MAX_CAPTURED_REQUESTS) : next
        }
      })
      return id
    },
    setResponse: (id, response) =>
      set((state) => ({
        entries: state.entries.map((entry) => (entry.id === id ? { ...entry, response } : entry))
      })),
    clear: (conversationId) =>
      set((state) => ({
        entries:
          conversationId === undefined
            ? []
            : state.entries.filter((entry) => entry.conversationId !== conversationId)
      }))
  }))
}
