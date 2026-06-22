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
