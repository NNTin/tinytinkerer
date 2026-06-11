import type { ChatEvent } from '@tinytinkerer/contracts'
import { buildConversationHistory } from './history'
import { activeCooldown } from './projections'
import type {
  ChatRuntimeFactory,
  Conversation,
  ConversationRepository,
  PersistedEvent,
  PreferencesStore
} from './ports'

// Cooldowns were once scoped per provider (issue #146: GitHub Models vs
// OpenRouter drew on separate upstream quotas). With LiteLLM as the sole
// provider the key is scoped per deployment (base URL) instead, mirroring the
// edge's per-(key, base URL) backoff: switching base URLs in Settings must
// not carry the old deployment's cooldown over (issue #179). Old unscoped
// `:litellm` and per-provider `:github`/`:openrouter` values are simply
// ignored — cooldowns are short-lived (≤ ~60s), so any orphaned value
// self-expires without migration.
export const RATE_LIMIT_COOLDOWN_KEY_PREFIX = 'rate_limit_cooldown_until:litellm'

export const rateLimitCooldownKey = (litellmBaseUrl?: string): string => {
  const baseUrl = litellmBaseUrl?.trim()
  return baseUrl
    ? `${RATE_LIMIT_COOLDOWN_KEY_PREFIX}:${baseUrl}`
    : RATE_LIMIT_COOLDOWN_KEY_PREFIX
}

/**
 * Read the active (non-expired) cooldown, or `undefined`. Shared by
 * {@link initializeChatState} and the chat store so send gating always
 * reflects the current cooldown.
 */
export const loadCooldown = async (
  preferences: PreferencesStore,
  litellmBaseUrl?: string
): Promise<string | undefined> =>
  activeCooldown(await preferences.get(rateLimitCooldownKey(litellmBaseUrl)))

export type ChatStateSnapshot = {
  conversationId: string | undefined
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  cooldownUntil: string | undefined
}

export const defaultChatState = (): ChatStateSnapshot => ({
  conversationId: undefined,
  events: [],
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined
})

export const initializeChatState = async (
  conversations: ConversationRepository,
  preferences: PreferencesStore,
  litellmBaseUrl?: string
): Promise<ChatStateSnapshot> => {
  const conversation = await getLatestConversationOrCreate(conversations)
  const storedEvents = await conversations.loadConversationEvents(conversation.id)
  const cooldownUntil = await loadCooldown(preferences, litellmBaseUrl)

  if (!cooldownUntil) {
    await preferences.set(rateLimitCooldownKey(litellmBaseUrl), '')
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
  preferences: PreferencesStore,
  litellmBaseUrl?: string
): Promise<Pick<ChatStateSnapshot, 'cooldownUntil' | 'isRetryPending'> | undefined> => {
  const cooldownKey = rateLimitCooldownKey(litellmBaseUrl)

  if (event.type === 'rate.limit.waiting') {
    await preferences.set(cooldownKey, event.payload.retryAt)
    return {
      cooldownUntil: event.payload.retryAt,
      isRetryPending: event.payload.autoRetry
    }
  }

  if (event.type === 'rate.limit.cancelled') {
    if (event.payload.reason === 'cancelled') {
      await preferences.set(cooldownKey, '')
      return { cooldownUntil: undefined, isRetryPending: false }
    }
    await preferences.set(cooldownKey, event.payload.retryAt)
    return { cooldownUntil: event.payload.retryAt, isRetryPending: false }
  }

  if (event.type === 'rate.limit.recovered') {
    await preferences.set(cooldownKey, '')
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

export const executeChatPrompt = async (options: {
  conversationId: string
  existingEvents: ChatEvent[]
  prompt: string
  runtimeFactory: ChatRuntimeFactory
  conversations: ConversationRepository
  preferences: PreferencesStore
  /** Scopes the rate-limit cooldown to the active LiteLLM deployment. */
  litellmBaseUrl?: string
  signal?: AbortSignal
  onEvent: (event: ChatEvent) => void | Promise<void>
  onRateLimitState: (
    state: Pick<ChatStateSnapshot, 'cooldownUntil' | 'isRetryPending'>
  ) => void | Promise<void>
}): Promise<void> => {
  const history = buildConversationHistory(options.existingEvents)

  const persistableTypes = new Set<ChatEvent['type']>([
    'user.message',
    'assistant.done',
    'error',
    'system',
    'rate.limit.waiting',
    'rate.limit.recovered',
    'rate.limit.cancelled',
    // Reasoning & activity: persist the final/granular events so the inline
    // per-turn panel reconstructs on reload. `reasoning.chunk` (like
    // `assistant.chunk`) is live-stream only — the persisted `reasoning.done`
    // carries the full text, keeping storage to ~one reasoning row per turn.
    'reasoning.done',
    'agent.run.started',
    'agent.run.completed',
    'agent.step.started',
    'agent.step.completed',
    'agent.step.failed',
    'agent.tool.started',
    'agent.tool.completed',
    'agent.tool.failed'
  ])

  for await (const event of runPrompt(
    options.runtimeFactory,
    options.prompt,
    history,
    options.signal
  )) {
    await options.onEvent(event)

    if (persistableTypes.has(event.type)) {
      await options.conversations.appendEvent(createPersistedEvent(options.conversationId, event))
    }

    const rateLimitState = await applyRateLimitEvent(
      event,
      options.preferences,
      options.litellmBaseUrl
    )
    if (rateLimitState) {
      await options.onRateLimitState(rateLimitState)
    }
  }
}

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
