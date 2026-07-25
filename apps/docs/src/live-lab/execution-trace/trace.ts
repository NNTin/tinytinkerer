import type { ChatEvent, InspectorEntry } from '@tinytinkerer/app-browser'

// The terminal outcome of one SETTLED (non-live) run, derived entirely from
// the same ChatEvent stream the product's own turn/activity/Pixel-Agents
// projections already read (issue #454) — there is no parallel
// instrumentation format. A LIVE run's badge is derived separately, by
// @tinytinkerer/pixel-agents's own `conversationActivityStatus`, so the
// running state the trace shows is always the SAME state the Pixel Agents
// office shows (see ExecutionTracePanel).
export type RunOutcome =
  | 'succeeded'
  | 'cancelled'
  | 'rate-limited'
  | 'permission-denied'
  | 'tool-failure'
  | 'error'

// Splits a conversation's event log into one slice per run, each starting at
// the `user.message` that triggered it — the exact same boundary
// `buildTurns` (from @tinytinkerer/app-browser) uses to start a new turn, so
// `buildTurns(slice)` always yields exactly one Turn for a run's own slice
// (for every run this lab's own composer starts — it always sends a prompt
// first). A leading slice with no preceding user.message (e.g. a persisted
// notice from an older event schema) starts its own slice rather than being
// dropped.
export const splitEventsIntoRuns = (events: readonly ChatEvent[]): ChatEvent[][] => {
  const runs: ChatEvent[][] = []
  for (const event of events) {
    if (event.type === 'user.message' || runs.length === 0) {
      runs.push([event])
      continue
    }
    runs[runs.length - 1]?.push(event)
  }
  return runs
}

// The terminal outcome of one settled run's own event slice (see
// RunOutcome). `wasCancelled` is host-supplied: the runtime emits no distinct
// "cancelled" ChatEvent for a Stop click (executeChatPrompt just stops
// forwarding events once its AbortSignal fires — see app-core's chat.ts), so
// whether THIS run ended because of a Stop click is state only the caller
// (the composer that dispatched the Stop) can supply. Precedence: a
// permission denial or tool failure is surfaced even for a run that went on
// to complete (still useful to know a tool failed mid-run), ahead of the
// coarser rate-limited/error/cancelled fallbacks that only apply to a run
// that never completed at all.
export const deriveRunOutcome = (
  events: readonly ChatEvent[],
  wasCancelled: boolean
): RunOutcome => {
  const permissionDenied = events.some(
    (event) => event.type === 'agent.tool.failed' && event.payload.kind === 'blocked'
  )
  if (permissionDenied) {
    return 'permission-denied'
  }

  const toolFailure = events.some(
    (event) =>
      event.type === 'agent.step.failed' ||
      (event.type === 'agent.tool.failed' && event.payload.kind !== 'blocked')
  )
  if (toolFailure) {
    return 'tool-failure'
  }

  if (events.some((event) => event.type === 'agent.run.completed')) {
    return 'succeeded'
  }

  const rateLimited = events.some(
    (event) =>
      event.type === 'rate.limit.waiting' ||
      (event.type === 'rate.limit.cancelled' && event.payload.reason === 'too_long')
  )
  if (rateLimited) {
    return 'rate-limited'
  }

  if (events.some((event) => event.type === 'error')) {
    return 'error'
  }

  return wasCancelled ? 'cancelled' : 'error'
}

// The captured model-request entries whose capture fell within one run's own
// time span — using ONLY the existing InspectorEntry contract (issue #454:
// "existing sanitization and inspector view models"), never a second capture
// path — so the trace can show "N request(s) prepared" per run instead of one
// undifferentiated conversation-wide list. `endIso` is EXCLUSIVE (the next
// run's first event timestamp, or `null` for the open-ended, still-live run).
export const requestsForRun = (
  entries: readonly InspectorEntry[],
  startIso: string,
  endIso: string | null
): InspectorEntry[] => {
  const start = Date.parse(startIso)
  const end = endIso ? Date.parse(endIso) : Number.POSITIVE_INFINITY
  return entries.filter((entry) => {
    const capturedAt = Date.parse(entry.request.capturedAt)
    return capturedAt >= start && capturedAt < end
  })
}
