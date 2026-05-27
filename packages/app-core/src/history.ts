import type { ChatEvent } from '@tinytinkerer/contracts'
import type { ConversationMessage } from './runtime'

export const buildConversationHistory = (events: ChatEvent[]): ConversationMessage[] => {
  const history: ConversationMessage[] = []
  let pendingUserText: string | undefined

  for (const event of events) {
    if (event.type === 'user.message') {
      pendingUserText = event.payload.text
      continue
    }

    if (event.type === 'assistant.done') {
      if (pendingUserText && event.payload.source.trim()) {
        history.push({ role: 'user', content: pendingUserText })
        history.push({ role: 'assistant', content: event.payload.source })
      }

      pendingUserText = undefined
    }
  }

  return history
}
