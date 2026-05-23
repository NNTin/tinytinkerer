import type { ChatEvent } from '@tinytinkerer/contracts'

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type PersistedEvent = ChatEvent & {
  conversationId: string
}
