import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { HumanPromptView, HumanPromptResult } from '@tinytinkerer/app-core'

// The host's single human-in-the-loop bridge (issue #85). Every human prompt — the
// Permissions allow/deny gate and the Choice-prompt poll — is the SAME machinery: a
// module-level queue of pending HumanPromptViews that the mounted <HumanPromptHost />
// resolves with the user's answer. A plugin builds a product-agnostic HumanPromptView
// and awaits `requestHumanInput` (wired into the PluginHost in create-runtime); the
// host renders it generically and resolves a HumanPromptResult the plugin maps back to
// its own outcome. There is ONE store and ONE modal, so adding a future HITL surface
// needs no new service, component, or per-shell mount — the run lifecycle names no
// feature.

// One queued human prompt: a stable id, the view the modal renders, and the resolve
// that settles the Promise returned by `requestHumanInput`. Removed from the queue the
// moment resolve is called, so the modal advances to the next. `scope` is the
// originating conversation id (issue #430), so a per-conversation Stop/reset can
// settle only its own prompts; absent for a scopeless caller (e.g. a headless host,
// or a test that calls `requestHumanInput` directly).
export type PendingHumanPrompt = {
  id: string
  view: HumanPromptView
  resolve: (result: HumanPromptResult) => void
  scope?: string
}

type HumanPromptState = { queue: PendingHumanPrompt[] }

const store = createStore<HumanPromptState>(() => ({ queue: [] }))
let counter = 0

const removeFromQueue = (id: string): void => {
  store.setState((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }))
}

// The injected PluginHost.requestHumanInput implementation: enqueue a view and return
// a Promise the mounted modal resolves with the user's answer. `scope` (the run's
// conversation id, issue #430) tags the entry so a per-conversation reset settles
// only its own prompts.
export const requestHumanInput = (
  view: HumanPromptView,
  scope?: string
): Promise<HumanPromptResult> =>
  new Promise<HumanPromptResult>((resolve) => {
    const id = `prompt-${(counter += 1)}`
    const entry: PendingHumanPrompt = {
      id,
      view,
      resolve: (result) => {
        removeFromQueue(id)
        resolve(result)
      },
      ...(scope !== undefined ? { scope } : {})
    }
    store.setState((state) => ({ queue: [...state.queue, entry] }))
  })

// Subscription hook the modal uses to read the head-of-queue prompt.
export const useHumanPromptStore = <T>(selector: (state: HumanPromptState) => T): T =>
  useStore(store, selector)

// Settle every open human prompt whose scope matches as `dismissed` and remove it from
// the queue. The chat-store calls this when a run is aborted (Stop) or the conversation
// is reset, so neither a permission prompt nor a choice poll outlives the run that
// raised it — now scoped per conversation (issue #430), so stopping/resetting
// conversation A never dismisses conversation B's pending prompt. `scope === undefined`
// settles EVERY pending prompt regardless of its own scope, preserving the pre-#430
// behavior for callers that abort before a conversation id is known (e.g. a
// pre-hydration abort). Resolving (not rejecting) means the awaiting gate/tool sees a
// normal "no answer" outcome — the permissions gate maps it to deny, the choice tool to
// a dismissed result.
export const resetHumanPrompts = (scope?: string): void => {
  // Snapshot before resolving: each `entry.resolve` below removes ITS entry from
  // the live queue as a side effect, so iterating the live array while mutating it
  // would skip entries.
  for (const entry of store.getState().queue) {
    if (scope === undefined || entry.scope === scope) {
      entry.resolve({ kind: 'dismissed' })
    }
  }
}
