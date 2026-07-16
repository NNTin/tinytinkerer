import type { ChatEvent } from '@tinytinkerer/contracts'
import { buildConversationHistory } from './history'
import { activeCooldown, appendLiveChatEvent } from './projections'
import type {
  ChatRuntimeFactory,
  Conversation,
  ConversationRepository,
  PersistedEvent,
  PreferencesStore
} from './ports'

// Cooldowns were once scoped per provider (issue #146: GitHub Models vs
// OpenRouter drew on separate upstream quotas). The key is now scoped by a
// caller-supplied `cooldownScope` instead — app-core stays agnostic about what
// the scope means; the browser layer happens to pass the LiteLLM deployment
// base URL, mirroring the edge's per-(key, base URL) backoff so switching base
// URLs in Settings must not carry the old deployment's cooldown over (issue
// #179). Old unscoped and per-provider (`:github`/`:openrouter`) values are
// simply ignored — cooldowns are short-lived (≤ ~60s), so any orphaned value
// self-expires without migration.
export const RATE_LIMIT_COOLDOWN_KEY_PREFIX = 'rate_limit_cooldown_until:litellm'

export const rateLimitCooldownKey = (cooldownScope?: string): string => {
  const scope = cooldownScope?.trim()
  return scope ? `${RATE_LIMIT_COOLDOWN_KEY_PREFIX}:${scope}` : RATE_LIMIT_COOLDOWN_KEY_PREFIX
}

/**
 * Read the active (non-expired) cooldown, or `undefined`. Shared by
 * {@link initializeConversationsState} and the chat store so send gating
 * always reflects the current cooldown.
 */
export const loadCooldown = async (
  preferences: PreferencesStore,
  cooldownScope?: string
): Promise<string | undefined> =>
  activeCooldown(await preferences.get(rateLimitCooldownKey(cooldownScope)))

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

// One conversation's chat state, keyed by conversation id in the store (issue
// #430). The store's top-level `events`/`isRunning`/`isRetryPending` are
// mirrors of the ACTIVE slice; every slice mutation flows through the store's
// single patch helper so the mirrors can never drift.
export type ConversationSlice = {
  id: string
  title: string
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  // Events loaded from the repository (lazily, on first activation). New
  // conversations start `true` — there is nothing to load.
  eventsLoaded: boolean
}

// The multi-conversation portion of the chat store's state. Structural subset
// of the store's full state so these pure helpers stay React/zustand-free.
export type ConversationsStateSnapshot = {
  // The active conversation id.
  conversationId: string | undefined
  // Mirrors of the active conversation's slice.
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  conversations: Record<string, ConversationSlice>
  // Most-recently-updated first at initialization; new conversations are
  // prepended, deleted ids removed. Not re-sorted on new events (issue #430).
  conversationOrder: string[]
}

// Preference key remembering which conversation was active, so a reload
// restores the conversation the user was looking at (issue #430). A stored id
// that no longer exists is ignored — see resolveActiveConversationId.
export const ACTIVE_CONVERSATION_KEY = 'active_conversation_id'

export const loadActiveConversationId = async (
  preferences: PreferencesStore
): Promise<string | undefined> => {
  const stored = await preferences.get(ACTIVE_CONVERSATION_KEY)
  return stored?.trim() ? stored : undefined
}

export const persistActiveConversationId = async (
  preferences: PreferencesStore,
  conversationId: string
): Promise<void> => {
  await preferences.set(ACTIVE_CONVERSATION_KEY, conversationId)
}

/**
 * The conversation to activate at startup: the stored preference when it still
 * names an existing conversation, otherwise the most recently updated one
 * (`conversationList` is most-recent-first per the repository contract).
 */
export const resolveActiveConversationId = (
  conversationList: Conversation[],
  storedId: string | undefined
): string | undefined =>
  storedId !== undefined && conversationList.some((entry) => entry.id === storedId)
    ? storedId
    : conversationList[0]?.id

const conversationSlice = (
  conversation: Conversation,
  events: ChatEvent[],
  eventsLoaded: boolean
): ConversationSlice => ({
  id: conversation.id,
  title: conversation.title,
  events,
  isRunning: false,
  isRetryPending: false,
  eventsLoaded
})

export type ConversationsInitState = ConversationsStateSnapshot &
  Pick<ChatStateSnapshot, 'cooldownUntil'>

/**
 * Multi-conversation successor of the old single-conversation initialization:
 * enumerate all conversations (creating one when none exist), restore the
 * active id from its preference (falling back to the most recently updated),
 * and load ONLY the active conversation's events — the other slices hydrate
 * lazily on first activation (`eventsLoaded: false`).
 */
export const initializeConversationsState = async (
  conversations: ConversationRepository,
  preferences: PreferencesStore,
  cooldownScope?: string
): Promise<ConversationsInitState> => {
  const listed = await conversations.listConversations()
  const conversationList = listed.length > 0 ? listed : [await conversations.createConversation()]
  const storedId = await loadActiveConversationId(preferences)
  // conversationList is never empty here, so the resolved id always exists.
  const activeConversationId = resolveActiveConversationId(conversationList, storedId) as string
  const activeEvents = await conversations.loadConversationEvents(activeConversationId)
  const cooldownUntil = await loadCooldown(preferences, cooldownScope)

  if (!cooldownUntil) {
    await preferences.set(rateLimitCooldownKey(cooldownScope), '')
  }

  const slices: Record<string, ConversationSlice> = {}
  for (const conversation of conversationList) {
    const isActive = conversation.id === activeConversationId
    slices[conversation.id] = conversationSlice(
      conversation,
      isActive ? activeEvents : [],
      isActive
    )
  }

  return {
    conversationId: activeConversationId,
    events: activeEvents,
    isRunning: false,
    isRetryPending: false,
    conversations: slices,
    conversationOrder: conversationList.map((conversation) => conversation.id),
    cooldownUntil
  }
}

/**
 * Patch making `conversationId` the active conversation and pointing the
 * top-level mirrors at its slice. Empty patch for an unknown id — activation
 * of a conversation that was deleted mid-flight must not corrupt the mirrors.
 */
export const activateConversationState = (
  state: ConversationsStateSnapshot,
  conversationId: string
): Partial<ConversationsStateSnapshot> => {
  const slice = state.conversations[conversationId]
  if (!slice) {
    return {}
  }
  return {
    conversationId,
    events: slice.events,
    isRunning: slice.isRunning,
    isRetryPending: slice.isRetryPending
  }
}

/**
 * Patch adding a freshly created conversation: empty slice (`eventsLoaded`
 * true — it is new), prepended to the order, and made active.
 */
export const addConversationToState = (
  state: ConversationsStateSnapshot,
  conversation: Conversation
): Partial<ConversationsStateSnapshot> => ({
  conversationId: conversation.id,
  events: [],
  isRunning: false,
  isRetryPending: false,
  conversations: {
    ...state.conversations,
    [conversation.id]: conversationSlice(conversation, [], true)
  },
  conversationOrder: [conversation.id, ...state.conversationOrder]
})

/**
 * Patch dropping a conversation's slice and order entry. When the removed
 * conversation was active, the mirrors reset to a "nothing active" state — the
 * store immediately activates the most recent remaining conversation (or
 * creates a fresh one) afterwards.
 */
export const removeConversationFromState = (
  state: ConversationsStateSnapshot,
  conversationId: string
): Partial<ConversationsStateSnapshot> => {
  const conversations = { ...state.conversations }
  delete conversations[conversationId]
  const base = {
    conversations,
    conversationOrder: state.conversationOrder.filter((id) => id !== conversationId)
  }
  if (state.conversationId !== conversationId) {
    return base
  }
  return {
    ...base,
    conversationId: undefined,
    events: [],
    isRunning: false,
    isRetryPending: false
  }
}

/**
 * THE one place a conversation slice mutates: computes the patch that
 * immutably replaces `conversations[conversationId]` (leaving every other
 * slice's object identity untouched) and, iff that id is the active
 * conversation at that moment, also updates the top-level mirrors. A run
 * streaming into a backgrounded conversation therefore never touches what the
 * surface renders. Empty patch for an unknown id (e.g. the tail of a deleted
 * conversation's run).
 */
export const patchConversationState = (
  state: ConversationsStateSnapshot,
  conversationId: string,
  patch:
    | Partial<Omit<ConversationSlice, 'id'>>
    | ((slice: ConversationSlice) => Partial<Omit<ConversationSlice, 'id'>>)
): Partial<ConversationsStateSnapshot> => {
  const slice = state.conversations[conversationId]
  if (!slice) {
    return {}
  }
  const next = { ...slice, ...(typeof patch === 'function' ? patch(slice) : patch) }
  const conversations = { ...state.conversations, [conversationId]: next }
  return state.conversationId === conversationId
    ? {
        conversations,
        events: next.events,
        isRunning: next.isRunning,
        isRetryPending: next.isRetryPending
      }
    : { conversations }
}

/**
 * The store-side hooks the conversation actions below need. The action bodies
 * live here rather than in the chat store so they load with app-core's lazy
 * chunk instead of every shell's tightly-budgeted entry chunk; the store passes
 * thin adapters and keeps only synchronous orchestration.
 */
// The store state the actions see: the conversation slices plus the global
// per-deployment cooldown (issue #179), which gates every conversation's sends.
export type ConversationsStoreState = ConversationsStateSnapshot &
  Pick<ChatStateSnapshot, 'cooldownUntil'>

export type ConversationActionsContext = {
  getState: () => ConversationsStoreState
  setState: (patch: Partial<ConversationsStoreState>) => void
  // The persistence ports the actions read/write. The browser shell object
  // satisfies this structurally, so the store passes it through as-is.
  shell: {
    conversations: ConversationRepository
    preferences: PreferencesStore
  }
  // Aborts the conversation's in-flight run and settles open human prompts —
  // the store's shared abort path (issues #332/#85).
  abortRun: (conversationId: string | undefined) => void
}

// Every slice mutation in the actions flows through patchConversationState so
// the active-conversation mirrors can never drift. Synchronous read-then-write
// is atomic here — JavaScript is single-threaded and nothing awaits in between.
const patchSlice = (
  context: ConversationActionsContext,
  conversationId: string,
  patch: Parameters<typeof patchConversationState>[2]
): void => {
  context.setState(patchConversationState(context.getState(), conversationId, patch))
}

/**
 * Load a slice's persisted events on demand (first activation, or a send into
 * a not-yet-viewed conversation). Loads at most once per slice.
 */
export const hydrateConversationSlice = async (
  context: ConversationActionsContext,
  conversationId: string
): Promise<void> => {
  const slice = context.getState().conversations[conversationId]
  if (!slice || slice.eventsLoaded) {
    return
  }
  const events = await context.shell.conversations.loadConversationEvents(conversationId)
  patchSlice(context, conversationId, { events, eventsLoaded: true })
}

/**
 * Make an existing conversation active, hydrating it first, and remember it as
 * the active conversation. No-op for an unknown or already-active id.
 */
export const selectConversationAction = async (
  context: ConversationActionsContext,
  conversationId: string
): Promise<void> => {
  const state = context.getState()
  if (!state.conversations[conversationId] || state.conversationId === conversationId) {
    return
  }
  await hydrateConversationSlice(context, conversationId)
  context.setState(activateConversationState(context.getState(), conversationId))
  await persistActiveConversationId(context.shell.preferences, conversationId)
}

/**
 * Create a fresh conversation, make it active, and remember it as active.
 */
export const startNewConversationAction = async (
  context: ConversationActionsContext
): Promise<void> => {
  const conversation = await context.shell.conversations.createConversation()
  context.setState(addConversationToState(context.getState(), conversation))
  await persistActiveConversationId(context.shell.preferences, conversation.id)
}

/**
 * Reset a conversation (the active one by default): abort its in-flight run
 * BEFORE clearing (issue #332) — otherwise the run keeps appending and
 * re-persisting its tail onto the conversation being emptied, resurrecting an
 * orphaned assistant turn that survives reload — then clear its persisted
 * events and its slice. Only the target's controller is aborted; runs in other
 * conversations are untouched. Returns whether the ACTIVE conversation was
 * reset, so the store can clear the (still global, issue #430 follow-up)
 * inspector buffer exactly as before.
 */
export const resetConversationAction = async (
  context: ConversationActionsContext,
  conversationId?: string
): Promise<boolean> => {
  const targetId = conversationId ?? context.getState().conversationId
  context.abortRun(targetId)
  const events = await resetConversation(context.shell.conversations, targetId)
  if (targetId) {
    patchSlice(context, targetId, { events, eventsLoaded: true })
  }
  return Boolean(targetId) && targetId === context.getState().conversationId
}

// One in-flight (or mid-send, issue #334) run's mutable handle, kept in the
// store's per-conversation closure map. The controller is assigned only after
// the pre-run awaits resolve.
export type ConversationRunHandle = {
  controller?: AbortController
}

export type ConversationRunContext = ConversationActionsContext & {
  // The cooldown scope (the LiteLLM deployment base URL, issue #179) lives in
  // the settings store, and the runtime factory is browser-layer code — the
  // store supplies both.
  getCooldownScope: () => string | undefined
  getRuntimeFactory: () => Promise<ChatRuntimeFactory>
}

/**
 * The body of the store's sendPrompt past its synchronous latch/cap gate:
 * resolve the target conversation (re-keying a pre-hydration placeholder latch
 * onto the actual active id so later sends into that conversation still hit
 * the latch, issue #334), gate via canSendPrompt (per-conversation run state +
 * global cooldown), hydrate, run, and stream events into the run's OWN
 * conversation slice (issue #430 — switching conversations mid-run leaves a
 * background run streaming into its own slice; patchConversationState only
 * touches the visible mirrors while that conversation is active). `execute` is
 * the store's (injectable, test-mockable) executeChatPrompt.
 */
export const sendConversationPromptAction = async (
  context: ConversationRunContext,
  options: {
    prompt: string
    // The explicitly requested target, if any; defaults to the active one.
    conversationId: string | undefined
    // The key this send latched under, its run handle, and the store's live
    // run map, so the placeholder key can be re-pointed at the resolved id.
    runKey: string
    run: ConversationRunHandle
    activeRuns: Map<string, ConversationRunHandle>
    execute: typeof executeChatPrompt
  }
): Promise<void> => {
  const { prompt, run } = options
  const conversationId = options.conversationId ?? context.getState().conversationId
  if (!conversationId) {
    return
  }
  if (conversationId !== options.runKey) {
    // The pre-hydration placeholder resolved to the actual active id; re-key so
    // later sends into this conversation hit the latch (issue #334).
    if (options.activeRuns.has(conversationId)) {
      return
    }
    options.activeRuns.delete(options.runKey)
    options.activeRuns.set(conversationId, run)
  }

  const slice = context.getState().conversations[conversationId]
  if (!slice) {
    return
  }
  // canSendPrompt mixes per-conversation run state with the global cooldown;
  // synthesize its snapshot from the target slice.
  if (
    !canSendPrompt({
      conversationId,
      events: slice.events,
      isRunning: slice.isRunning,
      isRetryPending: slice.isRetryPending,
      cooldownUntil: context.getState().cooldownUntil
    })
  ) {
    return
  }

  // A send into a never-activated conversation must build its history from the
  // persisted events, not an unhydrated empty slice.
  await hydrateConversationSlice(context, conversationId)

  const runtimeFactory = await context.getRuntimeFactory()
  const runController = new AbortController()
  run.controller = runController
  patchSlice(context, conversationId, { isRunning: true, isRetryPending: false })

  // Cooldowns are scoped per LiteLLM deployment (issue #179).
  const cooldownScope = context.getCooldownScope()

  try {
    await options.execute({
      conversationId,
      existingEvents: context.getState().conversations[conversationId]?.events ?? [],
      prompt,
      runtimeFactory,
      conversations: context.shell.conversations,
      preferences: context.shell.preferences,
      ...(cooldownScope === undefined ? {} : { cooldownScope }),
      signal: runController.signal,
      onEvent: (event) => {
        // Drop events from a run aborted mid-stream (e.g. by a reset) so its
        // tail cannot land on the fresh conversation (issue #332), and collapse
        // live-only stream snapshots so they don't accumulate without bound
        // (issue #339).
        if (runController.signal.aborted) {
          return
        }
        patchSlice(context, conversationId, (current) => ({
          events: appendLiveChatEvent(current.events, event)
        }))
      },
      onRateLimitState: (rateLimitState) => {
        // The cooldown is global per deployment; the retry flag belongs to this
        // run's conversation.
        context.setState({ cooldownUntil: rateLimitState.cooldownUntil })
        patchSlice(context, conversationId, { isRetryPending: rateLimitState.isRetryPending })
      }
    })
  } finally {
    patchSlice(context, conversationId, { isRunning: false, isRetryPending: false })
  }
}

/**
 * Abort the conversation's run (same path as reset, issue #332), delete it
 * from the repository, and drop its slice; when it was active, activate the
 * most recent remaining conversation — hydrating it exactly like a
 * user-initiated switch — or create a fresh one when none remain. No-op for an
 * unknown id.
 */
export const deleteConversationAction = async (
  context: ConversationActionsContext,
  conversationId: string
): Promise<void> => {
  if (!context.getState().conversations[conversationId]) {
    return
  }
  // Abort before the rows disappear so the doomed run stops streaming and
  // persisting (issue #332).
  context.abortRun(conversationId)
  await context.shell.conversations.deleteConversation(conversationId)
  const wasActive = context.getState().conversationId === conversationId
  context.setState(removeConversationFromState(context.getState(), conversationId))
  if (!wasActive) {
    return
  }
  const nextId = context.getState().conversationOrder[0]
  if (nextId) {
    await selectConversationAction(context, nextId)
  } else {
    // The chat always has a conversation: recreate via the same path as the
    // store's startNewConversation.
    await startNewConversationAction(context)
  }
}

export const createPersistedEvent = (conversationId: string, event: ChatEvent): PersistedEvent => ({
  ...event,
  conversationId
})

export const applyRateLimitEvent = async (
  event: ChatEvent,
  preferences: PreferencesStore,
  cooldownScope?: string
): Promise<Pick<ChatStateSnapshot, 'cooldownUntil' | 'isRetryPending'> | undefined> => {
  const cooldownKey = rateLimitCooldownKey(cooldownScope)

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

/**
 * The text of the most recent user message in an event log, or `undefined` when
 * the conversation has no user turn yet. Backs the "regenerate" capability: the
 * chat store re-runs this prompt as a fresh generation, preserving the existing
 * conversation history. Scans from the end, so it returns after one step when
 * the latest event is the user's prompt (the common case) and is O(n) only when
 * a tail of assistant/tool events follows it.
 */
export const latestUserPrompt = (events: ChatEvent[]): string | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'user.message') {
      return event.payload.text
    }
  }
  return undefined
}

export const runPrompt = (
  runtimeFactory: ChatRuntimeFactory,
  prompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> =>
  runtimeFactory.create().run(prompt, signal ? { signal, history } : { history })

export const executeChatPrompt = async (options: {
  conversationId: string
  existingEvents: ChatEvent[]
  prompt: string
  runtimeFactory: ChatRuntimeFactory
  conversations: ConversationRepository
  preferences: PreferencesStore
  /**
   * Scopes the rate-limit cooldown. Opaque to app-core; the browser layer
   * passes the active LiteLLM deployment base URL.
   */
  cooldownScope?: string
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
    // Stop the instant the run is aborted (e.g. a mid-stream conversation
    // reset): no further events must be surfaced OR persisted, or the aborted
    // run's tail would resurrect itself into — and re-persist under — the
    // conversation that was just cleared (issue #332).
    if (options.signal?.aborted) {
      break
    }

    await options.onEvent(event)

    if (persistableTypes.has(event.type)) {
      await options.conversations.appendEvent(createPersistedEvent(options.conversationId, event))
    }

    const rateLimitState = await applyRateLimitEvent(
      event,
      options.preferences,
      options.cooldownScope
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
