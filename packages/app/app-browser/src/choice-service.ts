import type { ChoicePromptRequest, ChoicePromptResult } from '@tinytinkerer/contracts'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

// A choice poll awaiting a human answer (issue #85). `resolve` settles the promise
// returned by `requestUserChoice`; the entry is removed from the queue the moment it
// is called so the modal advances to the next pending request (if any). Mirrors
// PendingPermission.
export type PendingChoice = {
  id: string
  request: ChoicePromptRequest
  resolve: (result: ChoicePromptResult) => void
}

type ChoiceState = {
  queue: PendingChoice[]
}

// Module-level singleton, like the permission store and the telemetry sink: the
// runtime factory wires a plain `requestUserChoice` function into the plugin host,
// while React surfaces subscribe to the same store to render the modal. Both sides
// share this one store so a choice-prompt tool call raised deep in a runtime run
// reaches the mounted modal.
const choiceStore = createStore<ChoiceState>(() => ({ queue: [] }))

let counter = 0

const removeFromQueue = (id: string): void => {
  choiceStore.setState((state) => ({
    queue: state.queue.filter((entry) => entry.id !== id)
  }))
}

// The ChoicePromptRequestService implementation handed to the plugin host. Enqueues
// the request and resolves once the modal reports the user's answer. If no modal is
// mounted the promise never settles here; the runtime's human-input timeout is the
// backstop (it fails the tool), so a host that forgets to render the modal fails
// safe rather than hanging forever. Mirrors `requestPermission`.
export const requestUserChoice = (request: ChoicePromptRequest): Promise<ChoicePromptResult> =>
  new Promise<ChoicePromptResult>((resolve) => {
    const id = `choice-${(counter += 1)}`
    const entry: PendingChoice = {
      id,
      request,
      resolve: (result) => {
        removeFromQueue(id)
        resolve(result)
      }
    }
    choiceStore.setState((state) => ({ queue: [...state.queue, entry] }))
  })

export const useChoiceStore = <T>(selector: (state: ChoiceState) => T): T =>
  useStore(choiceStore, selector)

// Settle every pending choice as `dismissed` and clear the queue. The chat store
// calls this when a run is aborted (Stop) or the conversation is reset (issue #85),
// so an open poll never outlives the run that asked it. A dismissal is the honest
// outcome — the user didn't answer — so the model is told the user declined rather
// than the poll hanging until the human-input timeout. Also the test seam. Mirrors
// resetPermissionStore (which resolves deny).
export const resetChoiceStore = (): void => {
  for (const entry of choiceStore.getState().queue) {
    entry.resolve({ kind: 'dismissed' })
  }
  choiceStore.setState({ queue: [] })
}
