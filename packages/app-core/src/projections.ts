import type { ChatEvent } from '@tinytinkerer/contracts'

export type TimelineEntry = {
  id: string
  label: string
}

export type Turn = {
  id: string
  userText: string
  assistantText: string
  notice?: {
    kind: 'system' | 'error' | 'rate-limit'
    message: string
    level?: 'info' | 'warning' | 'error'
  }
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

export const buildTurns = (events: ChatEvent[], streamingText: string): Turn[] => {
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
        assistantText: ''
      }
    } else if (event.type === 'assistant.done') {
      if (pendingTurn) {
        pendingTurn.assistantText = event.payload.text
        pushPendingTurn()
      } else if (event.payload.text) {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: event.payload.text
        })
      }
    } else if (event.type === 'error') {
      if (pendingTurn) {
        pendingTurn.notice = {
          kind: 'error',
          message: event.payload.message,
          level: 'error'
        }
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: '',
          notice: {
            kind: 'error',
            message: event.payload.message,
            level: 'error'
          }
        })
      }
    } else if (event.type === 'system') {
      if (pendingTurn) {
        pendingTurn.notice = {
          kind: 'system',
          message: event.payload.message,
          level: event.payload.level
        }
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: '',
          notice: {
            kind: 'system',
            message: event.payload.message,
            level: event.payload.level
          }
        })
      }
    } else if (event.type === 'rate.limit.waiting' || event.type === 'rate.limit.cancelled') {
      if (pendingTurn) {
        pendingTurn.notice = {
          kind: 'rate-limit',
          message: event.payload.message,
          level: 'warning'
        }
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: '',
          notice: {
            kind: 'rate-limit',
            message: event.payload.message,
            level: 'warning'
          }
        })
      }
    }
  }

  if (pendingTurn) {
    pendingTurn.assistantText = streamingText
    pushPendingTurn()
  }

  return turns
}

export const buildCurrentTimeline = (events: ChatEvent[]): TimelineEntry[] => {
  let startIndex = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'user.message') {
      startIndex = index
      break
    }
  }

  return events
    .slice(startIndex)
    .map((event) => {
      const label = thinkingLabel(event)
      return label ? { id: event.id, label } : undefined
    })
    .filter((value): value is TimelineEntry => Boolean(value))
}
