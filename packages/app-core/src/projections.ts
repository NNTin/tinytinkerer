import type { ChatEvent, ContentDocument } from '@tinytinkerer/contracts'

export type TurnNotice = {
  kind: 'system' | 'error' | 'rate-limit'
  message: string
  level?: 'info' | 'warning' | 'error'
}

// Chronological items that make up a turn's inline reasoning & activity panel.
export type TurnActivityItem =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'label'; id: string; label: string }
  | {
      kind: 'tool'
      id: string
      toolId: string
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

const isContentDocument = (value: unknown): value is ContentDocument =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray((value as { nodes?: unknown }).nodes)

// Defensive coercion: persisted assistant events from earlier schemas may carry
// a raw markdown string as `payload.content` (see the v2 db.ts migration). The
// renderer requires a ContentDocument; treat anything else as missing so the
// existing `turn.assistantContent ?` guards skip rendering rather than crash.
const coerceAssistantContent = (value: unknown): ContentDocument | null =>
  isContentDocument(value) ? value : null

const thinkingLabel = (event: ChatEvent): string | undefined => {
  switch (event.type) {
    case 'planning.started':
      return 'Planning research steps'
    case 'execution.step.started':
      return event.payload.step.summary
    case 'tool.call.started': {
      const query = event.payload.input.query
      return typeof query === 'string' ? `Searching: ${query}` : 'Searching web'
    }
    case 'execution.step.completed':
      return event.payload.note
    default:
      return undefined
  }
}

// Routes an activity-bearing event into a turn's activity log, preserving
// chronological order. Tool start/complete/fail are coalesced onto a single
// item; reasoning chunks/done upsert a single reasoning item (the payload text
// is the full accumulated reasoning, so last writer wins).
const applyActivityEvent = (activity: TurnActivity, event: ChatEvent): void => {
  switch (event.type) {
    case 'planning.started':
    case 'execution.step.started':
    case 'execution.step.completed': {
      const label = thinkingLabel(event)
      if (label) {
        activity.items.push({ kind: 'label', id: event.id, label })
      }
      return
    }
    case 'tool.call.started': {
      activity.items.push({
        kind: 'tool',
        id: event.id,
        toolId: event.payload.toolId,
        status: 'started',
        input: event.payload.input
      })
      return
    }
    case 'tool.call.completed':
    case 'tool.call.failed': {
      const open = [...activity.items]
        .reverse()
        .find(
          (item): item is Extract<TurnActivityItem, { kind: 'tool' }> =>
            item.kind === 'tool' &&
            item.toolId === event.payload.toolId &&
            item.status === 'started'
        )
      if (event.type === 'tool.call.completed') {
        if (open) {
          open.status = 'completed'
          open.output = event.payload.output
        } else {
          activity.items.push({
            kind: 'tool',
            id: event.id,
            toolId: event.payload.toolId,
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
        (item): item is Extract<TurnActivityItem, { kind: 'reasoning' }> => item.kind === 'reasoning'
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
      const notice: TurnNotice = { kind: 'error', message: event.payload.message, level: 'error' }
      if (pendingTurn) {
        setNoticeIfHigherSeverity(pendingTurn, notice)
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantSource: '',
          assistantContent: null,
          isStreaming: false,
          activity: emptyActivity(),
          notice
        })
      }
    } else if (event.type === 'system') {
      const notice: TurnNotice = {
        kind: 'system',
        message: event.payload.message,
        level: event.payload.level
      }
      if (pendingTurn) {
        setNoticeIfHigherSeverity(pendingTurn, notice)
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantSource: '',
          assistantContent: null,
          isStreaming: false,
          activity: emptyActivity(),
          notice
        })
      }
    } else if (event.type === 'rate.limit.waiting' || event.type === 'rate.limit.cancelled') {
      const notice: TurnNotice = {
        kind: 'rate-limit',
        message: event.payload.message,
        level: 'warning'
      }
      if (pendingTurn) {
        setNoticeIfHigherSeverity(pendingTurn, notice)
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantSource: '',
          assistantContent: null,
          isStreaming: false,
          activity: emptyActivity(),
          notice
        })
      }
    } else if (pendingTurn) {
      applyActivityEvent(pendingTurn.activity, event)
    }
  }

  if (pendingTurn) {
    pushPendingTurn()
  }

  return turns
}
