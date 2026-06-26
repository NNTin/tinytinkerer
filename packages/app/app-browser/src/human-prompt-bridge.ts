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
// moment resolve is called, so the modal advances to the next.
export type PendingHumanPrompt = {
  id: string
  view: HumanPromptView
  resolve: (result: HumanPromptResult) => void
}

type HumanPromptState = { queue: PendingHumanPrompt[] }

const store = createStore<HumanPromptState>(() => ({ queue: [] }))
let counter = 0

const removeFromQueue = (id: string): void => {
  store.setState((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }))
}

// The injected PluginHost.requestHumanInput implementation: enqueue a view and return
// a Promise the mounted modal resolves with the user's answer.
export const requestHumanInput = (view: HumanPromptView): Promise<HumanPromptResult> =>
  new Promise<HumanPromptResult>((resolve) => {
    const id = `prompt-${(counter += 1)}`
    const entry: PendingHumanPrompt = {
      id,
      view,
      resolve: (result) => {
        removeFromQueue(id)
        resolve(result)
      }
    }
    store.setState((state) => ({ queue: [...state.queue, entry] }))
  })

// Subscription hook the modal uses to read the head-of-queue prompt.
export const useHumanPromptStore = <T>(selector: (state: HumanPromptState) => T): T =>
  useStore(store, selector)

// Settle every open human prompt as `dismissed` and clear the queue. The chat-store
// calls this when a run is aborted (Stop) or the conversation is reset, so neither a
// permission prompt nor a choice poll outlives the run that raised it. Resolving (not
// rejecting) means the awaiting gate/tool sees a normal "no answer" outcome — the
// permissions gate maps it to deny, the choice tool to a dismissed result.
export const resetAllHumanPrompts = (): void => {
  for (const entry of store.getState().queue) {
    entry.resolve({ kind: 'dismissed' })
  }
  store.setState({ queue: [] })
}
