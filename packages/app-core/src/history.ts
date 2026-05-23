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
      if (pendingUserText && event.payload.text.trim()) {
        history.push({ role: 'user', content: pendingUserText })
        history.push({ role: 'assistant', content: event.payload.text })
      }

      pendingUserText = undefined
    }
  }

  return history
}
