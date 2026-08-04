import type { ChatEvent } from '@tinytinkerer/contracts'
import type { ChatRuntimeFactory, ConversationSlice } from '@tinytinkerer/app-core'
// A REAL (eager) value import, unlike the rest of this store's app-core usage
// (which goes through `loadCoreModule()`'s lazy `import()`): the #334 latch
// needs ConversationRunRegistry synchronously, before sendPrompt's first
// await. Imported from this entry-safe local duplicate (issue #441), not
// `@tinytinkerer/app-core`, so this one eager need stays cheap instead of
// dragging that package's whole merged manualChunks bucket onto the entry.
import { ConversationRunRegistry, MAX_CONCURRENT_RUNS } from './run-registry'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppToolGroup } from '../app-tool-group'
import type { AppAssistantPolicy } from '../app-assistant-policy'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import type { PluginCatalogue } from '../app'
import type { AuthStore } from './auth-store'
import type { SettingsStore } from './settings-store'
import type { InspectorStore } from './inspector-store'
import type { HumanPromptActions } from '../human-prompt-bridge'

// Defined in app-core next to the pure state helpers that construct slices, so
// the construction logic stays out of every shell's entry chunk; re-exported
// here because the slice is part of the store's public state shape.
export type { ConversationSlice }

// The run-latch protocol (the pre-hydration '' placeholder key, re-key-on-
// resolve, the release-by-identity scan, and the cap arithmetic) is designed
// in app-core's run-registry.ts (issue #430 review) and duplicated into this
// store's entry-safe ./run-registry (issue #441) — re-exported here because
// MAX_CONCURRENT_RUNS is part of this store's public API (surfaces.tsx and
// unit tests import it from this module).
export { MAX_CONCURRENT_RUNS }

export type ChatState = {
  hydrated: boolean
  // The active conversation id. `events`/`isRunning`/`isRetryPending` below are
  // mirrors of the active conversation's slice, kept in lockstep by the store's
  // single patch helper so every existing single-conversation consumer keeps
  // reading the same fields it always has.
  conversationId: string | undefined
  events: ChatEvent[]
  isRunning: boolean
  isRetryPending: boolean
  // Global per LiteLLM deployment (issue #179), NOT per conversation: a 429 is
  // per credential/deployment, so one cooldown gates every conversation's sends.
  cooldownUntil: string | undefined
  conversations: Record<string, ConversationSlice>
  // Most-recently-updated first at initialization; new conversations are
  // prepended, deleted ids removed. Not re-sorted on new events (issue #430).
  conversationOrder: string[]
  initialize: () => Promise<void>
  // Sends into `conversationId`, defaulting to the active conversation.
  sendPrompt: (
    prompt: string,
    conversationId?: string,
    options?: {
      /**
       * Called once if this prompt actually gets a run, and never otherwise —
       * the re-entry latch, the concurrency cap, the outbound-send gate, and
       * the cooldown all refuse by returning early (issue #481 re-review).
       *
       * The returned promise cannot answer this: it resolves when the run
       * FINISHES, and resolves identically for a send that was refused.
       */
      onAdmitted?: () => void
    }
  ) => Promise<void>
  // Synchronous mirror of sendPrompt's two SYNCHRONOUS gates only — the
  // per-conversation re-entry latch (issue #334) and the MAX_CONCURRENT_RUNS
  // cap (issue #430) — for a surface that needs a synchronous accept/refuse
  // answer before sendPrompt's async work (module load, hydration) even
  // starts, to satisfy the #206 clear-on-accept contract. Deliberately does
  // NOT check isRunning/cooldown: those are already synchronously visible to
  // surfaces via the store's own state, so duplicating them here would just
  // create a second source of truth.
  canStartRun: (conversationId?: string) => boolean
  // Re-run the latest user prompt as a fresh generation, preserving the existing
  // conversation history. No-op when there is no user turn yet or a run is
  // already in flight (gated by sendPrompt). Backs the "regenerate" action.
  rerunLastPrompt: () => Promise<void>
  cancelRetry: (conversationId?: string) => void
  // Abort the in-flight generation (the "Stop" affordance). Shares the single
  // abort path with cancelRetry — both signal the same AbortController. Targets
  // the given conversation's run, defaulting to the active conversation.
  stop: (conversationId?: string) => void
  resetConversation: (conversationId?: string) => Promise<void>
  // Start a conversation over (the active one by default): abort its run,
  // discard it, and create and select a fresh one. Distinct from
  // `resetConversation`, which empties one in place and keeps its id and title —
  // see app-core's `restartConversationAction` for why this is one action rather
  // than delete-then-create at the call site.
  restartConversation: (conversationId?: string) => Promise<void>
  // Create a fresh conversation, make it active, and remember it as active.
  startNewConversation: () => Promise<void>
  // Make an existing conversation active, lazily loading its events from the
  // repository on first activation. No-op for an unknown or already-active id.
  selectConversation: (conversationId: string) => Promise<void>
  // Abort the conversation's run, delete it from the repository, and drop its
  // slice; when it was active, activate the most recent remaining conversation
  // or create a fresh one. No-op for an unknown id.
  deleteConversation: (conversationId: string) => Promise<void>
}

export type ChatStore = StoreApi<ChatState>

export const createChatStore = (options: {
  shell: BrowserShell
  authStore: AuthStore
  settingsStore: SettingsStore
  // Client-only sink for captured forwarded requests (issue #270). Passed down to
  // the runtime factory, which arms capture only while the inspector plugin is on.
  // Optional so tests can omit it; the app always provides it.
  inspectorStore?: InspectorStore
  /**
   * This app's plugin catalogue (issue #495), memoized by `createBrowserApp`.
   *
   * Awaited once when the runtime factory is first built, and the resulting
   * modules handed to `createBrowserRuntimeFactory`. Threaded in rather than
   * imported: which plugins a runtime gets is a property of the app that owns
   * this store, and a document can hold several apps with different catalogues.
   *
   * Optional so a directly-constructed store (only tests do that) can omit it;
   * absent means a runtime with no plugins, which is what a bare store had
   * before too. Every real app supplies it, because `createBrowserApp` requires
   * it.
   */
  loadPlugins?: PluginCatalogue
  // The host app's always-on tool group (e.g. an integrated shell's stage
  // verbs). Forwarded to the runtime factory; absent for web/widget/mobile.
  appToolGroup?: AppToolGroup
  // The host app's grounding/answer policy (issue #478). Forwarded to the
  // runtime factory; absent for every app that contributes none.
  appAssistantPolicy?: AppAssistantPolicy
  /**
   * This app's human-in-the-loop queue, as the two callbacks this store and the
   * runtime it builds actually need (issue #489).
   *
   * `reset` settles the prompts an aborted run left open; `request` is handed to
   * the runtime factory, which wires it into the PluginHost. Passing the pair
   * rather than the store keeps both this store and the runtime unable to read
   * or subscribe to a queue at all — including their own.
   *
   * Optional, and absent means a store with no human-input path: `stop`/reset
   * settle nothing, and the runtime it builds exposes no `requestHumanInput`
   * capability, so a HITL plugin contributes no tool exactly as it does on a
   * headless host. An app supplies one iff it declared `humanInput` (the
   * default) — the documentation apps deliberately do not, so absence is a real
   * production configuration here, not only a test shortcut.
   */
  humanPrompts?: HumanPromptActions
  /**
   * Approval for anything about to leave this app (issue #481).
   *
   * Awaited by `sendPrompt`, which is the one call every PROMPT SEND reaches:
   * the composer, `rerunLastPrompt` (Regenerate), and whatever #472 adds. A
   * gate that lived only in the composer was not a gate — Regenerate sent a
   * whole persisted conversation past it.
   *
   * Scope, precisely: this gates conversation and tool content on its way to a
   * model. It is not a network kill switch — model-catalogue lookups, status
   * polling and telemetry take their own paths and are not routed through it.
   *
   * Absent for every app without a pre-send disclosure, which is all of them
   * today, and then this costs a single `undefined` check per send.
   */
  outboundSendGate?: (prompt: string) => Promise<boolean>
}): ChatStore => {
  // Per-conversation run state (issue #430), owned by ConversationRunRegistry
  // (app-core) — the synchronous re-entry latch (issue #334), the cap, and the
  // re-key-on-resolve protocol all live there now. An entry's presence is the
  // synchronous re-entry latch: it is set before sendPrompt's first await and
  // removed only after the run settles, so a second send into the SAME
  // conversation during that window no-ops while sends into other
  // conversations stay independent.
  const runRegistry = new ConversationRunRegistry(MAX_CONCURRENT_RUNS)
  let initializePromise: Promise<void> | null = null
  let runtimeFactoryPromise: Promise<ChatRuntimeFactory> | null = null

  // Single abort path shared by `stop` (abort a live run), `cancelRetry` (abort
  // a queued auto-retry), reset, and delete — now scoped to one conversation's
  // controller (issue #332, per conversation). Keeping one implementation
  // avoids drift between the affordances.
  // Settle a conversation's open human prompts (permission allow/deny, choice
  // poll) so none outlives the run that raised it (issue #85). Generic — names no
  // specific feature. No-op when nothing is pending.
  //
  // Scoped per conversation (issue #430): settling A never dismisses B's pending
  // prompt. An unknown conversation id (the pre-hydration abort path) settles
  // every prompt in THIS APP's queue (issue #489) — never another app's, which is
  // not reachable from here.
  //
  // Its own function because a run ENDS in two different ways, and only one of
  // them is an abort: Stop/reset cancel a live run, while a run that simply
  // finished — including one whose human-input budget expired — has nothing left
  // to cancel and still has a prompt to clear (issue #498).
  const settleHumanPrompts = (conversationId: string | undefined) => {
    options.humanPrompts?.reset(conversationId)
  }

  const abortConversationRun = (conversationId: string | undefined) => {
    if (conversationId !== undefined) {
      runRegistry.abort(conversationId)
    }
    settleHumanPrompts(conversationId)
  }

  const ensureInitialized = async (set: ChatStore['setState'], get: ChatStore['getState']) => {
    if (get().hydrated) {
      return
    }
    if (initializePromise) {
      return initializePromise
    }

    initializePromise = loadCoreModule()
      .then(async ({ initializeConversationsState }) => {
        const state = await initializeConversationsState(
          options.shell.conversations,
          options.shell.preferences,
          // Cooldowns are scoped per LiteLLM deployment (issue #179).
          options.settingsStore.getState().litellmBaseUrl
        )
        set({ ...state, hydrated: true })
      })
      .finally(() => {
        initializePromise = null
      })

    return initializePromise
  }

  const getRuntimeFactory = async (): Promise<ChatRuntimeFactory> => {
    runtimeFactoryPromise ??= (async () => {
      const { createBrowserRuntimeFactory } = await import('../runtime/get-runtime')
      const pluginModules = (await options.loadPlugins?.()) ?? []
      return createBrowserRuntimeFactory({
        shell: options.shell,
        authStore: options.authStore,
        settingsStore: options.settingsStore,
        pluginModules,
        ...(options.appToolGroup ? { appToolGroup: options.appToolGroup } : {}),
        ...(options.appAssistantPolicy ? { appAssistantPolicy: options.appAssistantPolicy } : {}),
        // This app's prompt queue (issue #489). The factory tags each request
        // with the run's conversation id and hands the result to the PluginHost;
        // omitting it — which only a directly-constructed store does — leaves
        // the runtime with no human-input capability at all.
        ...(options.humanPrompts ? { requestHumanInput: options.humanPrompts.request } : {}),
        // The runtime arms this only while the inspector plugin is enabled, so a
        // disabled inspector captures (and retains) nothing. Records the request as
        // a pending entry — tagged with the run's conversation id (issue #430),
        // forwarded by createRuntime's wrapping — and returns an updater the
        // chokepoint calls with the paired response outcome.
        ...(options.inspectorStore
          ? {
              captureForwardedRequest: (request, conversationId) => {
                const store = options.inspectorStore
                if (!store) return
                const id = store.getState().capture(request, conversationId)
                return (response) => store.getState().setResponse(id, response)
              }
            }
          : {})
      })
    })()
    return runtimeFactoryPromise
  }

  const store = createStore<ChatState>((set, get) => {
    // Adapters for app-core's conversation actions (send/select/create/reset/
    // delete/hydrate): the bodies live in the lazily-loaded core chunk, keeping
    // this entry-chunk file to synchronous orchestration. Every slice mutation
    // flows through app-core's patchConversationState, the single helper that
    // keeps the top-level active-conversation mirrors in lockstep.
    const conversationActions = {
      getState: get,
      setState: set,
      // The one non-conversation field action code writes directly (issue
      // #430 review: ConversationActionsContext.setState is branded to
      // conversation-mirror-safe patches only — see chat.ts).
      setCooldownUntil: (cooldownUntil: string | undefined) => set({ cooldownUntil }),
      shell: options.shell,
      abortRun: abortConversationRun,
      // Cooldowns are scoped per LiteLLM deployment (issue #179).
      getCooldownScope: () => options.settingsStore.getState().litellmBaseUrl,
      getRuntimeFactory
    }

    // Shared trampoline: hydrate the store, then run an app-core action.
    const withCore = async (
      action: (core: Awaited<ReturnType<typeof loadCoreModule>>) => Promise<unknown>
    ) => {
      await ensureInitialized(set, get)
      await action(await loadCoreModule())
    }

    return {
      hydrated: false,
      conversationId: undefined,
      events: [],
      isRunning: false,
      isRetryPending: false,
      cooldownUntil: undefined,
      conversations: {},
      conversationOrder: [],
      initialize: () => ensureInitialized(set, get),
      canStartRun: (conversationId) => {
        const runKey = conversationId ?? get().conversationId ?? ''
        return !runRegistry.has(runKey) && runRegistry.size < MAX_CONCURRENT_RUNS
      },
      sendPrompt: async (prompt, conversationId, sendOptions) => {
        // Gate re-entry synchronously (issue #334), now per conversation: a
        // second send/regenerate into the SAME conversation that fires while
        // the first is still resolving its awaits (module load, runtime
        // factory) would otherwise start a concurrent run against it. Before
        // hydration the active conversation id is unknown; such sends latch on
        // the '' placeholder key (they all target the same conversation, and
        // ids are UUIDs, so '' can never collide with a real one).
        // tryAcquire also enforces the concurrency cap (issue #430): entries
        // exist exactly while a conversation is running or mid-send, so the
        // registry's size is the count.
        const runKey = conversationId ?? get().conversationId ?? ''
        const handle = runRegistry.tryAcquire(runKey)
        if (!handle) {
          return
        }
        try {
          // Nothing leaves this app before its disclosure is acknowledged
          // (issue #481). Inside the run latch, so a reader answering the dialog
          // cannot have a second send slip in beside this one; before any
          // conversation state is touched, so a decline leaves no trace.
          //
          // Checked HERE rather than only at the composer because this is the
          // call every send shares — `rerunLastPrompt` reaches it directly.
          if (options.outboundSendGate && !(await options.outboundSendGate(prompt))) {
            return
          }
          await ensureInitialized(set, get)
          const { executeChatPrompt, sendConversationPromptAction } = await loadCoreModule()
          // Target resolution, gating (per-conversation run state + global
          // cooldown), hydration, and streaming into the run's OWN conversation
          // slice live in app-core — only this orchestration stays in the entry
          // chunk. executeChatPrompt is injected so tests keep their mock seam.
          await sendConversationPromptAction(conversationActions, {
            prompt,
            conversationId,
            handle,
            registry: runRegistry,
            execute: executeChatPrompt,
            ...(sendOptions?.onAdmitted ? { onAdmitted: sendOptions.onAdmitted } : {})
          })
        } finally {
          // The action may have re-keyed the handle (via registry.rekey) from
          // the pre-hydration placeholder onto the resolved conversation id;
          // release() finds whichever key currently holds it, and reports it.
          const finished = runRegistry.release(handle)

          // Settle any human prompt this run left queued (issue #498).
          //
          // Normally there is none: a HITL tool blocks the run until the reader
          // answers, so the send cannot reach here first. The exception is the
          // human-input BUDGET. `withTimeout` (agent-core) races the tool against
          // `humanInputTimeoutMs` and rejects, but nothing cancels the underlying
          // `requestHumanInput` promise — so the entry stays queued, the run
          // finishes without it, and the reader is left with a question whose run
          // is gone (and, once #498's launcher badge exists, a badge advertising
          // it). The same holds for a run that fails for any other reason while a
          // prompt is open.
          //
          // Scoped to THIS app (the queue is per app since #489) and to the
          // conversation that just finished — never an unscoped reset, which would
          // dismiss a prompt belonging to another conversation still running
          // beside this one.
          //
          // Truthiness, not `!== undefined`: the pre-hydration placeholder key is
          // `''`, and a run that never resolved a conversation also never gave its
          // runtime one — so any prompt it raised is unscoped and would not have
          // matched `settleHumanPrompts('')` anyway. Passing `''` through would be
          // the one thing that must not happen here, since an undefined id
          // deliberately settles everything.
          if (finished) settleHumanPrompts(finished)
        }
      },
      rerunLastPrompt: async () => {
        await ensureInitialized(set, get)
        const { latestUserPrompt } = await loadCoreModule()
        const prompt = latestUserPrompt(get().events)
        if (!prompt) {
          return
        }
        // Reuse the normal send path: it re-checks the cooldown/running gate and
        // appends a fresh generation, so history is preserved (issue: regenerate).
        await get().sendPrompt(prompt)
      },
      cancelRetry: (conversationId) => {
        const targetId = conversationId ?? get().conversationId
        abortConversationRun(targetId)
        if (targetId) {
          // A pending retry implies a run already loaded app-core, so this
          // settles on the already-resolved import promise immediately.
          void loadCoreModule().then(({ patchConversationState }) => {
            set((state) => patchConversationState(state, targetId, { isRetryPending: false }))
          })
        }
      },
      stop: (conversationId) => {
        abortConversationRun(conversationId ?? get().conversationId)
      },
      resetConversation: (conversationId) =>
        withCore(async (core) => {
          // Abort-before-clear and per-conversation scoping live in the action
          // (issue #332); it resolves and reports the target id that was reset.
          const targetId = await core.resetConversationAction(conversationActions, conversationId)
          if (targetId) {
            // Drop that conversation's captured inspector requests too (issue
            // #430) — they belong to the run that was just reset, so the
            // developer panel must not still show them for it.
            options.inspectorStore?.getState().clear(targetId)
          }
        }),
      restartConversation: (conversationId) =>
        withCore(async (core) => {
          const targetId = conversationId ?? get().conversationId
          await core.restartConversationAction(conversationActions, conversationId)
          // The discarded conversation's captured inspector requests go with it
          // (issue #430) — they belonged to a run that no longer has a home.
          if (targetId) {
            options.inspectorStore?.getState().clear(targetId)
          }
        }),
      startNewConversation: () =>
        withCore((core) => core.startNewConversationAction(conversationActions)),
      selectConversation: (conversationId) =>
        withCore((core) => core.selectConversationAction(conversationActions, conversationId)),
      deleteConversation: (conversationId) =>
        withCore(async (core) => {
          await core.deleteConversationAction(conversationActions, conversationId)
          // Drop the deleted conversation's captured inspector requests too (issue
          // #430) — a no-op filter when it had none (e.g. an unknown id).
          options.inspectorStore?.getState().clear(conversationId)
        })
    }
  })

  // Cooldowns are scoped per LiteLLM deployment (issue #179). When the user
  // switches the base URL, reload that deployment's cooldown so send gating
  // reflects it immediately instead of carrying the previous deployment's
  // window (issue #146). The store lives for the app's lifetime, so we never
  // need to unsubscribe.
  options.settingsStore.subscribe((state, prev) => {
    if (state.litellmBaseUrl === prev.litellmBaseUrl) {
      return
    }
    void loadCoreModule().then(async ({ loadCooldown }) => {
      const cooldownUntil = await loadCooldown(options.shell.preferences, state.litellmBaseUrl)
      store.setState({ cooldownUntil })
    })
  })

  return store
}
