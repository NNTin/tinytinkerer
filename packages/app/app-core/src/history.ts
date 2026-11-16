import type { ChatEvent } from '@tinytinkerer/contracts'
import type { ConversationMessage } from './runtime'

// One user/assistant pair per turn. A resumed run (#531) appends a second
// `assistant.done` to the same turn; the latest non-empty answer wins.
export const buildConversationHistory = (events: ChatEvent[]): ConversationMessage[] => {
  const history: ConversationMessage[] = []
  let pendingUserText: string | undefined
  let answerAt = -1

  for (const event of events) {
    if (event.type === 'user.message') {
      pendingUserText = event.payload.text
      answerAt = -1
      continue
    }

    if (event.type === 'assistant.done' && pendingUserText && event.payload.source.trim()) {
      const answer = { role: 'assistant' as const, content: event.payload.source }
      if (answerAt < 0) {
        history.push({ role: 'user', content: pendingUserText })
        answerAt = history.push(answer) - 1
      } else {
        history[answerAt] = answer
      }
    }
  }

  return history
}
