import type { ChatEvent, ContentDocument } from '@tinytinkerer/contracts'

export type TimelineEntry = {
  id: string
  label: string
}

export type TurnNotice = {
  kind: 'system' | 'error' | 'rate-limit'
  message: string
  level?: 'info' | 'warning' | 'error'
}

export type Turn = {
  id: string
  userText: string
  assistantSource: string
  assistantContent: ContentDocument | null
  isStreaming: boolean
  notice?: TurnNotice
}

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
        isStreaming: false
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
          isStreaming: true
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
          isStreaming: false
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
          notice
        })
      }
    }
  }

  if (pendingTurn) {
    pushPendingTurn()
  }

  return turns
}

export const buildCurrentTimeline = (events: ChatEvent[]): TimelineEntry[] => {
  let startIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'user.message') {
      startIndex = index
      break
    }
  }

  if (startIndex === -1) {
    return []
  }

  return events
    .slice(startIndex)
    .map((event) => {
      const label = thinkingLabel(event)
      return label ? { id: event.id, label } : undefined
    })
    .filter((value): value is TimelineEntry => Boolean(value))
}
