import type { ChatEvent } from '@tinytinkerer/contracts'
import { activeCooldown } from './projections'
import type {
  ChatRuntimeFactory,
  Conversation,
  ConversationRepository,
  PersistedEvent,
  PreferencesStore
} from './ports'

export const RATE_LIMIT_COOLDOWN_KEY = 'rate_limit_cooldown_until'

export type ChatStateSnapshot = {
  conversationId: string | undefined
  events: ChatEvent[]
  streamingText: string
  isRunning: boolean
  isRetryPending: boolean
  cooldownUntil: string | undefined
}

export const defaultChatState = (): ChatStateSnapshot => ({
  conversationId: undefined,
  events: [],
  streamingText: '',
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined
})

export const initializeChatState = async (
  conversations: ConversationRepository,
  preferences: PreferencesStore
): Promise<ChatStateSnapshot> => {
  const conversation = await getLatestConversationOrCreate(conversations)
  const storedEvents = await conversations.loadConversationEvents(conversation.id)
  const cooldownUntil = activeCooldown(await preferences.get(RATE_LIMIT_COOLDOWN_KEY))

  if (!cooldownUntil) {
    await preferences.set(RATE_LIMIT_COOLDOWN_KEY, '')
  }

  return {
    ...defaultChatState(),
    conversationId: conversation.id,
    events: storedEvents,
    cooldownUntil
  }
}

export const createPersistedEvent = (
  conversationId: string,
  event: ChatEvent
): PersistedEvent => ({
  ...event,
  conversationId
})

export const applyRateLimitEvent = async (
  event: ChatEvent,
  preferences: PreferencesStore
): Promise<Pick<ChatStateSnapshot, 'cooldownUntil' | 'isRetryPending'> | undefined> => {
  if (event.type === 'rate.limit.waiting') {
    await preferences.set(RATE_LIMIT_COOLDOWN_KEY, event.payload.retryAt)
    return {
      cooldownUntil: event.payload.retryAt,
      isRetryPending: event.payload.autoRetry
    }
  }

  if (event.type === 'rate.limit.cancelled') {
    await preferences.set(RATE_LIMIT_COOLDOWN_KEY, event.payload.retryAt)
    return {
      cooldownUntil: event.payload.retryAt,
      isRetryPending: false
    }
  }

  if (event.type === 'rate.limit.recovered') {
    await preferences.set(RATE_LIMIT_COOLDOWN_KEY, '')
    return {
      cooldownUntil: undefined,
      isRetryPending: false
    }
  }

  return undefined
}

export const canSendPrompt = (state: ChatStateSnapshot): boolean =>
  Boolean(state.conversationId) && !state.isRunning && !activeCooldown(state.cooldownUntil)

export const runPrompt = (
  runtimeFactory: ChatRuntimeFactory,
  prompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> =>
  runtimeFactory
    .create()
    .run(prompt, signal ? { signal, history } : { history })

export const resetConversation = async (
  conversations: ConversationRepository,
  conversationId: string | undefined
): Promise<ChatEvent[]> => {
  if (!conversationId) {
    return []
  }

  await conversations.clearConversationEvents(conversationId)
  return []
}

const getLatestConversationOrCreate = async (
  conversations: ConversationRepository
): Promise<Conversation> => (await conversations.getLatestConversation()) ?? conversations.createConversation()
