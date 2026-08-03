import { createStore, type StoreApi } from 'zustand/vanilla'
import type { HumanPromptView, HumanPromptResult } from '@tinytinkerer/app-core'

// The human-in-the-loop bridge (issue #85), owned by ONE `BrowserApp` (issue
// #489). Every human prompt — the Permissions allow/deny gate and the
// Choice-prompt poll — is the SAME machinery: a queue of pending
// HumanPromptViews that a mounted <HumanPromptHost /> resolves with the user's
// answer. A plugin builds a product-agnostic HumanPromptView and awaits
// `requestHumanInput` (wired into the PluginHost in create-runtime); the host
// renders it generically and resolves a HumanPromptResult the plugin maps back to
// its own outcome. Adding a future HITL surface needs no new service, component,
// or per-shell mount — the run lifecycle names no feature.
//
// ## Why the queue belongs to the app rather than the module (issue #489)
//
// It was a module-level singleton until a document could hold more than one
// `BrowserApp` — the documentation assistant beside its live labs (#479). Then
// one queue for the whole document mis-routed in three ways at once, because
// every reader resolves the prompt's SURROUNDING data from the app it is mounted
// under: the per-plugin `presentation` setting deciding modal-vs-composer, the
// conversation title labelling the question, and `reset`'s idea of which
// conversation ids exist. A prompt raised by app A was drawn with app B's
// answers to all three, and a `composer` prompt appeared in — and could be
// answered from — an unrelated session's composer.
//
// Scoping by a session discriminant on each entry would have made that a
// `filter` every present and future reader has to remember. Owning one queue per
// app makes it structural instead: a reader can only ever see its own app's
// prompts, because that is the only queue it can reach. This is the same shape
// as every sibling store on `BrowserApp` (auth, chat, settings, status,
// inspector) and as the pre-send disclosure gate (#481), which is per-app for
// the same reason.
//
// Multiplicity that remains, deliberately: several SHELLS and several surfaces
// can share one app (apps/host's root composition renders three `ChatApp`s;
// every `<LiveLab>` on a docs page mounts its own shell over one lab app). They
// are views of one session, so they all show that session's prompt and answering
// through any one of them settles it everywhere. See
// `tests/human-prompt-session-routing.test.tsx`.

// One queued human prompt: a stable id, the view the modal renders, and the resolve
// that settles the Promise returned by `requestHumanInput`. Removed from the queue the
// moment resolve is called, so the modal advances to the next. `scope` is the
// originating conversation id (issue #430), so a per-conversation Stop/reset can
// settle only its own prompts; absent for a scopeless caller (e.g. a headless host,
// or a test that calls `request` directly). There is no session field: the queue
// itself is the session (issue #489).
export type PendingHumanPrompt = {
  id: string
  view: HumanPromptView
  resolve: (result: HumanPromptResult) => void
  scope?: string
}

/**
 * The two callbacks everything downstream of the store actually needs.
 *
 * Threaded into the chat store and the runtime it builds instead of the store
 * itself, so neither can subscribe to, enumerate, or re-publish another app's
 * queue — they can only add to their own and settle their own.
 */
export type HumanPromptActions = {
  /**
   * The injected `PluginHost.requestHumanInput` implementation: enqueue a view and
   * return a Promise the mounted host resolves with the user's answer. `scope`
   * (the run's conversation id, issue #430) tags the entry so a per-conversation
   * reset settles only its own prompts.
   */
  request: (view: HumanPromptView, scope?: string) => Promise<HumanPromptResult>
  /**
   * Settle every open prompt IN THIS APP whose scope matches as `dismissed` and
   * remove it from the queue. The chat store calls this when a run is aborted
   * (Stop) or the conversation is reset, so neither a permission prompt nor a
   * choice poll outlives the run that raised it — scoped per conversation (issue
   * #430), so stopping/resetting conversation A never dismisses conversation B's
   * pending prompt.
   *
   * `scope === undefined` settles every prompt in THIS app's queue regardless of
   * its own scope, preserving the pre-#430 behavior for callers that abort before
   * a conversation id is known (e.g. a pre-hydration abort). It has never meant
   * "every prompt in the document", and since #489 it cannot: another app's queue
   * is not reachable from here.
   *
   * Resolving (not rejecting) means the awaiting gate/tool sees a normal "no
   * answer" outcome — the permissions gate maps it to deny, the choice tool to a
   * dismissed result.
   */
  reset: (scope?: string) => void
}

export type HumanPromptState = { queue: PendingHumanPrompt[] } & HumanPromptActions

export type HumanPromptStore = StoreApi<HumanPromptState>

/**
 * Build one app's prompt queue. Called once per `BrowserApp`, before the chat
 * store that forwards its actions (see `createBrowserApp`).
 */
export const createHumanPromptStore = (): HumanPromptStore =>
  createStore<HumanPromptState>((set, get) => {
    let counter = 0

    const removeFromQueue = (id: string): void => {
      set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }))
    }

    return {
      queue: [],

      request: (view, scope) =>
        new Promise<HumanPromptResult>((resolve) => {
          counter += 1
          const id = `prompt-${counter}`
          const entry: PendingHumanPrompt = {
            id,
            view,
            resolve: (result) => {
              removeFromQueue(id)
              resolve(result)
            },
            ...(scope !== undefined ? { scope } : {})
          }
          set((state) => ({ queue: [...state.queue, entry] }))
        }),

      reset: (scope) => {
        // Snapshot before resolving: each `entry.resolve` below removes ITS entry
        // from the live queue as a side effect, so iterating the live array while
        // mutating it would skip entries.
        for (const entry of get().queue) {
          if (scope === undefined || entry.scope === scope) {
            entry.resolve({ kind: 'dismissed' })
          }
        }
      }
    }
  })
