import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

// Shared bridge for human-in-the-loop prompts (issue #85). A "human prompt" is a
// request raised deep inside a runtime run that BLOCKS on a person answering it in
// the UI — today the Permissions allow/deny gate and the Choice-prompt poll. Each
// is the same machinery: a module-level zustand store holding a queue of pending
// requests, a `request()` that enqueues one and returns a Promise the mounted modal
// resolves, a `useStore` hook the modal subscribes to, and a `reset()` that settles
// every pending request with a safe default. This factory is that machinery once;
// `permission-service` and `choice-service` are thin instantiations (they differ
// only in the request/result types, the id prefix, and the reset value).
//
// WHY A FACTORY (and not two copies): the run lifecycle must settle EVERY open human
// prompt when a run is aborted or the conversation is reset, so none lingers past the
// run that raised it. Each bridge auto-registers its `reset` here, and the chat-store
// calls the single `resetAllHumanPrompts()` — so the generic lifecycle path names no
// specific feature, and a future HITL surface is settled automatically just by using
// this factory. Introduced for the two surfaces that exist today, not a speculative
// third.

// One queued human prompt: a stable id, the request the modal renders, and the
// `resolve` that settles the Promise returned by `request()`. The entry is removed
// from the queue the moment `resolve` is called so the modal advances to the next.
export type PendingPrompt<Req, Res> = {
  id: string
  request: Req
  resolve: (result: Res) => void
}

// The store state a bridge exposes to its modal — a queue of pending prompts. Kept
// as a `{ queue }` object (not a bare array) so a modal selects with
// `(state) => state.queue[0]`, the shape both modals already use.
export type PromptState<Req, Res> = {
  queue: PendingPrompt<Req, Res>[]
}

export type HumanPromptBridge<Req, Res> = {
  request: (request: Req) => Promise<Res>
  useStore: <T>(selector: (state: PromptState<Req, Res>) => T) => T
  reset: () => void
}

// The reset of every bridge created in this module, drained by resetAllHumanPrompts.
const registeredResets: Array<() => void> = []

export const createHumanPromptBridge = <Req, Res>(options: {
  // Short prefix for generated entry ids (e.g. 'perm', 'choice'); only needs to be
  // unique enough to read in a debugger — ids are not cross-referenced.
  idPrefix: string
  // The value every pending request is settled with on `reset()`: the safe "no
  // answer" outcome for this prompt (e.g. deny for permissions, dismissed for choice).
  resetValue: Res
}): HumanPromptBridge<Req, Res> => {
  const store = createStore<PromptState<Req, Res>>(() => ({ queue: [] }))
  let counter = 0

  const removeFromQueue = (id: string): void => {
    store.setState((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }))
  }

  const request = (request: Req): Promise<Res> =>
    new Promise<Res>((resolve) => {
      const id = `${options.idPrefix}-${(counter += 1)}`
      const entry: PendingPrompt<Req, Res> = {
        id,
        request,
        resolve: (result) => {
          removeFromQueue(id)
          resolve(result)
        }
      }
      store.setState((state) => ({ queue: [...state.queue, entry] }))
    })

  const useBridgeStore = <T>(selector: (state: PromptState<Req, Res>) => T): T =>
    useStore(store, selector)

  // Settle every pending request with the safe default and clear the queue. Called
  // by resetAllHumanPrompts on run abort / conversation reset, and reused as the
  // test seam. Resolving (not rejecting) means the awaiting tool/gate sees a normal
  // "no answer" outcome rather than a thrown error.
  const reset = (): void => {
    for (const entry of store.getState().queue) {
      entry.resolve(options.resetValue)
    }
    store.setState({ queue: [] })
  }

  registeredResets.push(reset)

  return { request, useStore: useBridgeStore, reset }
}

// Settle every open human prompt across all bridges (issue #85). The chat-store
// calls this when a run is aborted (Stop) or the conversation is reset, so neither a
// permission prompt nor a choice poll outlives the run that raised it. Generic by
// construction — it names no feature, and any bridge created via the factory above
// is included automatically.
export const resetAllHumanPrompts = (): void => {
  for (const reset of registeredResets) {
    reset()
  }
}
