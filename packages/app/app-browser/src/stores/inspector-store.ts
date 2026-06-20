import type { InspectorRequestPayload } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'

// Bound on retained captures (issue #270, decision #4). Each payload carries the
// full forwarded context (system prompt + history + tool observations), so this is
// a ring buffer rather than an unbounded log: a turn issues several model calls
// (decide → synthesize, etc.), so ~20 keeps the last several turns without growing
// memory unboundedly. Live-only — never persisted, never serialized to telemetry.
export const MAX_CAPTURED_REQUESTS = 20

export type InspectorState = {
  requests: InspectorRequestPayload[]
  capture: (payload: InspectorRequestPayload) => void
  clear: () => void
}

export type InspectorStore = StoreApi<InspectorState>

// A client-only, in-memory store for captured forwarded requests. It is created
// for every browser app but only ever written to while the inspector plugin is
// enabled (the runtime injects the capture sink off that activation state) and
// only ever read by the web app's inspector panel. It deliberately uses no
// persistence middleware so the heavy conversation payload never reaches disk.
export const createInspectorStore = (): InspectorStore =>
  createStore<InspectorState>((set) => ({
    requests: [],
    capture: (payload) =>
      set((state) => {
        const next = [...state.requests, payload]
        return {
          requests: next.length > MAX_CAPTURED_REQUESTS ? next.slice(-MAX_CAPTURED_REQUESTS) : next
        }
      }),
    clear: () => set({ requests: [] })
  }))
