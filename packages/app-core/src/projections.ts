import type { ChatEvent } from '@tinytinkerer/contracts'

export type TimelineEntry = {
  id: string
  label: string
}

export type Turn = {
  id: string
  userText: string
  assistantText: string
  isError?: boolean
  errorMessage?: string
  systemMessage?: string
  systemLevel?: 'info' | 'warning' | 'error'
  rateLimitMessage?: string
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
  let userEventId: string | null = null
  let userText: string | null = null

  for (const event of events) {
    if (event.type === 'user.message') {
      userEventId = event.id
      userText = event.payload.text
    } else if (event.type === 'assistant.done') {
      if (userEventId !== null && userText !== null) {
        turns.push({ id: userEventId, userText, assistantText: event.payload.text })
        userEventId = null
        userText = null
      }
    } else if (event.type === 'error') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          isError: true,
          errorMessage: event.payload.message
        })
        userEventId = null
        userText = null
      }
    } else if (event.type === 'system') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          systemMessage: event.payload.message,
          systemLevel: event.payload.level
        })
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: '',
          systemMessage: event.payload.message,
          systemLevel: event.payload.level
        })
      }
    } else if (event.type === 'rate.limit.waiting') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          rateLimitMessage: event.payload.message
        })
      }
    }
  }

  if (userEventId !== null && userText !== null) {
    turns.push({ id: userEventId, userText, assistantText: streamingText })
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
