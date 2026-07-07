import type {
  AgentStepKind,
  ChatEvent,
  ContentDocument,
  ReActDecisionKind
} from '@tinytinkerer/contracts'

export type TurnNotice = {
  kind: 'system' | 'error' | 'rate-limit'
  message: string
  level?: 'info' | 'warning' | 'error'
}

// Chronological items that make up a turn's inline reasoning & activity panel.
// `stepId` is an item's own step id and `parentId` its parent step's id; the
// panel uses them to render the agent-trace hierarchy as an indented tree.
// `stepKind` lets the renderer style steps (e.g. 'think') distinctly.
export type TurnActivityItem =
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'label'
      id: string
      label: string
      stepId?: string
      parentId?: string
      stepKind?: AgentStepKind
      // For a ReAct `think` step: `decisionKind` drives the action/final colour +
      // cue in the renderer. The model's "why" is the step's own `label` (the
      // streamed thought), not a separate field (issue #276).
      decisionKind?: ReActDecisionKind
    }
  | {
      kind: 'tool'
      id: string
      toolId: string
      stepId?: string
      parentId?: string
      status: 'started' | 'completed' | 'failed'
      input?: Record<string, unknown>
      output?: unknown
      error?: string
    }

export type TurnActivity = {
  items: TurnActivityItem[]
  reasoningText: string
}

export type Turn = {
  id: string
  userText: string
  assistantSource: string
  assistantContent: ContentDocument | null
  isStreaming: boolean
  activity: TurnActivity
  notice?: TurnNotice
}

const emptyActivity = (): TurnActivity => ({ items: [], reasoningText: '' })

export const activeCooldown = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp) || timestamp <= Date.now()) {
    return undefined
  }

  return value
}

const noticeSeverity = (notice: TurnNotice): number => {
  if (notice.kind === 'error') return 3
  if (notice.kind === 'rate-limit') return 2
  return 1
}

const setNoticeIfHigherSeverity = (turn: Turn, candidate: TurnNotice): void => {
  if (!turn.notice || noticeSeverity(candidate) > noticeSeverity(turn.notice)) {
    turn.notice = candidate
  }
}

// Attach a notice (error / system / rate-limit) to the in-flight turn if there is
// one — keeping only the highest-severity notice — otherwise push a notice-only
// turn so a notice emitted with no pending assistant turn still surfaces. Shared
// by the error, system, and rate-limit event branches, which differ only in the
// notice they build.
const attachOrCreateNoticeTurn = (
  turns: Turn[],
  pendingTurn: Turn | undefined,
  eventId: string,
  notice: TurnNotice
): void => {
  if (pendingTurn) {
    setNoticeIfHigherSeverity(pendingTurn, notice)
    return
  }
  turns.push({
    id: eventId,
    userText: '',
    assistantSource: '',
    assistantContent: null,
    isStreaming: false,
    activity: emptyActivity(),
    notice
  })
}

const isContentDocument = (value: unknown): value is ContentDocument =>
  value !== null && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes)

// Defensive coercion: persisted assistant events from earlier schemas may carry
// a raw markdown string as `payload.content` (see the v2 db.ts migration). The
// renderer requires a ContentDocument; treat anything else as missing so the
// existing `turn.assistantContent ?` guards skip rendering rather than crash.
const coerceAssistantContent = (value: unknown): ContentDocument | null =>
  isContentDocument(value) ? value : null

const thinkingLabel = (event: ChatEvent): string | undefined => {
  switch (event.type) {
    case 'agent.run.completed':
      return `Completed ${event.payload.steps} steps`
    default:
      return undefined
  }
}

// Routes an activity-bearing event into a turn's activity log, preserving
// chronological order. Tool start/complete/fail are coalesced onto a single
// item; reasoning chunks/done upsert a single reasoning item (the payload text
// is the full accumulated reasoning, so last writer wins).
const findLabelByStep = (
  activity: TurnActivity,
  stepId: string
): Extract<TurnActivityItem, { kind: 'label' }> | undefined =>
  activity.items.find(
    (item): item is Extract<TurnActivityItem, { kind: 'label' }> =>
      item.kind === 'label' && item.stepId === stepId
  )

const applyActivityEvent = (activity: TurnActivity, event: ChatEvent): void => {
  switch (event.type) {
    case 'agent.run.started':
      return
    case 'agent.step.started': {
      activity.items.push({
        kind: 'label',
        id: event.id,
        label: event.payload.title,
        stepId: event.payload.stepId,
        stepKind: event.payload.kind,
        ...(event.payload.parentStepId ? { parentId: event.payload.parentStepId } : {}),
        // Carried by the non-streaming ReAct path (the streaming path sets this on
        // agent.step.completed once the decision resolves).
        ...(event.payload.decisionKind ? { decisionKind: event.payload.decisionKind } : {})
      })
      return
    }
    case 'agent.step.delta': {
      // Live thought streaming: grow the matching step's label in place.
      const existing = findLabelByStep(activity, event.payload.stepId)
      if (existing) {
        existing.label = event.payload.text
      }
      return
    }
    case 'agent.step.completed': {
      const summary = event.payload.summary
      const hasSummary = summary !== undefined && summary.trim().length > 0
      const started = findLabelByStep(activity, event.payload.stepId)
      // A think step's final thought updates its own label (and replaces the
      // "Thinking…" placeholder / last streamed delta). Other steps' summaries
      // (observation notes) are appended as their own chronological label.
      if (started?.stepKind === 'think') {
        // The model's prose (or empty, for a silent tool-call turn) rides on the
        // summary. Set it whenever present — including an explicit '' from the
        // streaming path, which clears the live "Thinking…" so the step renders as
        // just the decision badge. An ABSENT summary (the non-streaming path) leaves
        // the title-derived label intact (issue #276).
        if (summary !== undefined) {
          started.label = summary
        }
        // The streaming decision path resolves the kind at end-of-stream and carries
        // it here; fold it onto the think step so the renderer can colour/label it
        // action vs final.
        if (event.payload.decisionKind) {
          started.decisionKind = event.payload.decisionKind
        }
        return
      }
      // An 'act' step wraps a tool call, and its summary is the serialized tool
      // result (see serializeToolNote in agent-runtime-base). The nested tool item
      // already renders that result via the tool's ActivityView, so surfacing the
      // summary again here is a duplicate (issue #277) — drop it. Other step kinds'
      // summaries (e.g. 'observe') are genuine observation notes and are kept.
      if (started?.stepKind === 'act') {
        return
      }
      // Observation note for another non-think step: render at the step's own depth
      // (stepId, but no stepKind so it doesn't define hierarchy itself).
      if (hasSummary) {
        activity.items.push({
          kind: 'label',
          id: event.id,
          label: summary,
          stepId: event.payload.stepId
        })
      }
      return
    }
    case 'agent.step.failed': {
      // Carry stepId so the error renders at the failed step's depth, keeping
      // it within the step hierarchy rather than at the root.
      activity.items.push({
        kind: 'label',
        id: event.id,
        label: event.payload.error,
        stepId: event.payload.stepId
      })
      return
    }
    case 'agent.run.completed': {
      const label = thinkingLabel(event)
      if (label) {
        activity.items.push({ kind: 'label', id: event.id, label })
      }
      return
    }
    case 'agent.tool.started': {
      activity.items.push({
        kind: 'tool',
        id: event.id,
        toolId: event.payload.toolId,
        stepId: event.payload.stepId,
        ...(event.payload.parentStepId ? { parentId: event.payload.parentStepId } : {}),
        status: 'started',
        input: event.payload.input
      })
      return
    }
    case 'agent.tool.completed':
    case 'agent.tool.failed': {
      const open = [...activity.items]
        .reverse()
        .find(
          (item): item is Extract<TurnActivityItem, { kind: 'tool' }> =>
            item.kind === 'tool' &&
            item.stepId === event.payload.stepId &&
            item.status === 'started'
        )
      if (event.type === 'agent.tool.completed') {
        if (open) {
          open.status = 'completed'
          open.output = event.payload.output
        } else {
          activity.items.push({
            kind: 'tool',
            id: event.id,
            toolId: event.payload.toolId,
            stepId: event.payload.stepId,
            status: 'completed',
            output: event.payload.output
          })
        }
      } else if (open) {
        open.status = 'failed'
        open.error = event.payload.error
      } else {
        activity.items.push({
          kind: 'tool',
          id: event.id,
          toolId: event.payload.toolId,
          stepId: event.payload.stepId,
          status: 'failed',
          error: event.payload.error
        })
      }
      return
    }
    case 'reasoning.chunk':
    case 'reasoning.done': {
      activity.reasoningText = event.payload.text
      const existing = activity.items.find(
        (item): item is Extract<TurnActivityItem, { kind: 'reasoning' }> =>
          item.kind === 'reasoning'
      )
      if (existing) {
        existing.text = event.payload.text
      } else {
        activity.items.unshift({ kind: 'reasoning', id: event.id, text: event.payload.text })
      }
      return
    }
    default:
      return
  }
}

// `assistant.chunk` and `reasoning.chunk` are live-stream-only: each payload
// carries the FULL accumulated source, parsed content, and text so far
// (last-writer-wins), and neither is ever persisted. Retaining every one makes a
// streamed
// answer cost O(chunks²) memory (hundreds of growing snapshots) and O(n²) array
// copying. Because only the latest matters to the in-flight turn, we keep at
// most one of each live in the array (issue #339).
const LIVE_ONLY_COLLAPSIBLE: ReadonlySet<ChatEvent['type']> = new Set([
  'assistant.chunk',
  'reasoning.chunk'
])

// Which live chunks a `*.done` supersedes: once a terminal event lands (it
// carries the final snapshot/text) the live chunks it subsumes are pure dead
// weight and are dropped. `assistant.done` is the turn's terminal event, so it
// clears BOTH stream types (any reasoning it didn't already close via
// `reasoning.done` is settled too) — this bounds retention regardless of how
// reasoning and content deltas interleaved.
const DONE_SUPERSEDES: Partial<Record<ChatEvent['type'], readonly ChatEvent['type'][]>> = {
  'assistant.done': ['assistant.chunk', 'reasoning.chunk'],
  'reasoning.done': ['reasoning.chunk']
}

/**
 * Append a runtime event to the live event log while bounding the retention of
 * live-only stream snapshots (issue #339). Pure and total, so the chat store can
 * use it as its `onEvent` reducer and it can be unit-tested directly:
 *
 * - a collapsible live chunk replaces its immediately-preceding same-type
 *   sibling instead of growing the array (its payload already subsumes it);
 * - a `*.done` event drops the live chunk it supersedes, so a settled turn
 *   retains zero stream snapshots.
 *
 * buildTurns treats a chunk and its done via last-writer-wins, so both prunings
 * leave the derived turns unchanged. Persistence is unaffected — the pruned
 * chunk types were never persisted.
 */
export const appendLiveChatEvent = (events: ChatEvent[], event: ChatEvent): ChatEvent[] => {
  if (LIVE_ONLY_COLLAPSIBLE.has(event.type)) {
    const last = events[events.length - 1]
    if (last && last.type === event.type) {
      const next = events.slice(0, -1)
      next.push(event)
      return next
    }
    return [...events, event]
  }

  const superseded = DONE_SUPERSEDES[event.type]
  if (superseded) {
    const drop = new Set<ChatEvent['type']>(superseded)
    return [...events.filter((existing) => !drop.has(existing.type)), event]
  }

  return [...events, event]
}

export const buildTurns = (events: ChatEvent[]): Turn[] => {
  const turns: Turn[] = []
  let pendingTurn: Turn | undefined

  const pushPendingTurn = () => {
    if (!pendingTurn) {
      return
    }

    turns.push(pendingTurn)
    pendingTurn = undefined
  }

  for (const event of events) {
    if (event.type === 'user.message') {
      pushPendingTurn()
      pendingTurn = {
        id: event.id,
        userText: event.payload.text,
        assistantSource: '',
        assistantContent: null,
        isStreaming: false,
        activity: emptyActivity()
      }
    } else if (event.type === 'assistant.chunk') {
      const content = coerceAssistantContent(event.payload.content)
      if (pendingTurn) {
        pendingTurn.assistantSource = event.payload.source
        pendingTurn.assistantContent = content
        pendingTurn.isStreaming = true
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantSource: event.payload.source,
          assistantContent: content,
          isStreaming: true,
          activity: emptyActivity()
        })
      }
    } else if (event.type === 'assistant.done') {
      const hasSource = event.payload.source.trim().length > 0
      const content = coerceAssistantContent(event.payload.content)
      if (pendingTurn) {
        pendingTurn.assistantSource = event.payload.source
        pendingTurn.assistantContent = hasSource ? content : null
        pendingTurn.isStreaming = false
        pushPendingTurn()
      } else if (hasSource) {
        turns.push({
          id: event.id,
          userText: '',
          assistantSource: event.payload.source,
          assistantContent: content,
          isStreaming: false,
          activity: emptyActivity()
        })
      }
    } else if (event.type === 'error') {
      attachOrCreateNoticeTurn(turns, pendingTurn, event.id, {
        kind: 'error',
        message: event.payload.message,
        level: 'error'
      })
    } else if (event.type === 'system') {
      attachOrCreateNoticeTurn(turns, pendingTurn, event.id, {
        kind: 'system',
        message: event.payload.message,
        level: event.payload.level
      })
    } else if (event.type === 'rate.limit.waiting' || event.type === 'rate.limit.cancelled') {
      attachOrCreateNoticeTurn(turns, pendingTurn, event.id, {
        kind: 'rate-limit',
        message: event.payload.message,
        level: 'warning'
      })
    } else if (pendingTurn) {
      applyActivityEvent(pendingTurn.activity, event)
    }
  }

  if (pendingTurn) {
    pushPendingTurn()
  }

  return turns
}

// A tool item carries the only potentially-large fields (`input`/`output`), so
// compare those by reference — buildTurns reuses the same event-payload objects
// across rebuilds, keeping a settled turn O(1) to check even with big results.
// reasoning/label items hold only small strings, so a JSON compare is both cheap
// and compact (buildTurns emits stable key order).
const activityItemEqual = (a: TurnActivityItem, b: TurnActivityItem): boolean => {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tool' && b.kind === 'tool') {
    return (
      a.id === b.id &&
      a.toolId === b.toolId &&
      a.stepId === b.stepId &&
      a.parentId === b.parentId &&
      a.status === b.status &&
      a.error === b.error &&
      a.input === b.input &&
      a.output === b.output
    )
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

const activitiesEqual = (a: TurnActivity, b: TurnActivity): boolean =>
  a.reasoningText === b.reasoningText &&
  a.items.length === b.items.length &&
  a.items.every((item, index) => {
    const other = b.items[index]
    return other !== undefined && activityItemEqual(item, other)
  })

/**
 * Whether two turns are render-equivalent — same id and same content down to
 * the activity log. `buildTurns` returns fresh `Turn` objects on every call, so
 * during streaming a settled turn is rebuilt (new object, equal value) on every
 * delta. The chat surface reconciles new turns against the previous array with
 * this predicate to reuse the prior object for unchanged turns, restoring
 * referential stability so `React.memo` can skip re-rendering settled turns
 * (issue #340). `assistantContent` is compared by reference: for a settled turn
 * it is the same `event.payload.content` object across rebuilds.
 */
export const turnsEquivalent = (a: Turn, b: Turn): boolean =>
  a.id === b.id &&
  a.userText === b.userText &&
  a.assistantSource === b.assistantSource &&
  a.assistantContent === b.assistantContent &&
  a.isStreaming === b.isStreaming &&
  JSON.stringify(a.notice) === JSON.stringify(b.notice) &&
  activitiesEqual(a.activity, b.activity)

/**
 * Reconcile a freshly-built turn list against the previous one, reusing each
 * previous `Turn` object whenever {@link turnsEquivalent} holds. Turns are
 * matched by position (the log is append-only, so a turn's index is stable),
 * which keeps this O(n) per delta while giving settled turns referential
 * stability for memoized rendering (issue #340).
 */
export const reconcileTurns = (previous: Turn[], next: Turn[]): Turn[] =>
  next.map((turn, index) => {
    const before = previous[index]
    return before && turnsEquivalent(before, turn) ? before : turn
  })
