import type { ChatEvent, EventType } from '@tinytinkerer/contracts'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// Monotonic per-session counter: timestamps only have millisecond resolution, so
// back-to-back events can collide; `seq` breaks those ties on replay (issue #333).
// Resetting on session load is fine — timestamps already differ across sessions.
let nextSeq = 0

export const createEvent = <T extends EventType>(
  type: T,
  payload: Extract<ChatEvent, { type: T }>['payload']
): Extract<ChatEvent, { type: T }> =>
  ({
    id: createId(),
    timestamp: new Date().toISOString(),
    seq: nextSeq++,
    type,
    payload
  }) as Extract<ChatEvent, { type: T }>
