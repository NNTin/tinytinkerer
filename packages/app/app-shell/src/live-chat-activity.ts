import { useEffect, useRef } from 'react'
import type { ChatEvent } from '@tinytinkerer/contracts'

export type UseLiveChatActivityOptions = {
  // Gate for the whole hook: while false nothing is seeded or delivered, and
  // going false -> true always re-seeds from the log currently in view (see below).
  enabled: boolean
  onRunStarted: () => void
  onRunEnded: () => void
  onLiveEvents: (events: readonly ChatEvent[]) => void
}

// Everything is "seen" when idle; mid-run, everything up to and including the
// last `agent.run.started` is seen (that boundary is what "still running" means
// here) and the remaining tail is delivered as the initial catch-up.
const seedSeenEvents = (events: readonly ChatEvent[], isRunning: boolean): Set<string> => {
  if (!isRunning) return new Set(events.map((event) => event.id))
  let runStart = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'agent.run.started') {
      runStart = index
      break
    }
  }
  return new Set(events.slice(0, runStart + 1).map((event) => event.id))
}

const unseenEvents = (events: readonly ChatEvent[], seen: Set<string>): ChatEvent[] => {
  const unseen: ChatEvent[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    unseen.push(event)
  }
  return unseen
}

// This exists so a passive stage (one with no chat surface of its own, e.g. Pixel
// Agents) can project live chat activity from the persisted event log without
// replaying history on every mount or reconnect, and so this seeding logic lives
// in one place instead of being reimplemented per stage. A stage enables the hook
// once it is ready to receive activity (e.g. after its own bootstrap handshake);
// enabling mid-run seeds from the last run boundary and immediately delivers the
// unseen tail, so a late-arriving stage still catches up on the in-flight run.
export const useLiveChatActivity = (
  events: readonly ChatEvent[],
  isRunning: boolean,
  options: UseLiveChatActivityOptions
): void => {
  // Callbacks are read through this ref so the effect below depends only on
  // `events`, `isRunning`, and `enabled` — callers may pass inline closures
  // without causing the effect to re-fire on their identity churn.
  const optionsRef = useRef(options)
  optionsRef.current = options

  const seenRef = useRef<Set<string>>(new Set())
  const wasEnabledRef = useRef(false)
  const wasRunningRef = useRef(isRunning)

  useEffect(() => {
    if (!options.enabled) {
      wasEnabledRef.current = false
      return
    }

    if (!wasEnabledRef.current) {
      // Just enabled: seed from the log currently in view instead of replaying
      // it, then deliver only the unseen tail if a run is already in flight.
      wasEnabledRef.current = true
      wasRunningRef.current = isRunning
      seenRef.current = seedSeenEvents(events, isRunning)
      if (isRunning) {
        const unseen = unseenEvents(events, seenRef.current)
        if (unseen.length > 0) optionsRef.current.onLiveEvents(unseen)
      }
      return
    }

    if (isRunning && !wasRunningRef.current) {
      seenRef.current = seedSeenEvents(events, true)
      optionsRef.current.onRunStarted()
      const unseen = unseenEvents(events, seenRef.current)
      if (unseen.length > 0) optionsRef.current.onLiveEvents(unseen)
    } else if (isRunning) {
      const unseen = unseenEvents(events, seenRef.current)
      if (unseen.length > 0) optionsRef.current.onLiveEvents(unseen)
    } else if (wasRunningRef.current) {
      optionsRef.current.onRunEnded()
      seenRef.current = new Set(events.map((event) => event.id))
    }

    wasRunningRef.current = isRunning
    // `options` itself is intentionally excluded: callbacks are read through
    // optionsRef above so passing inline closures never re-fires this effect.
  }, [events, isRunning, options.enabled])
}
