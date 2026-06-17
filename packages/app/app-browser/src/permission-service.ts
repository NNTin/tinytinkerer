import type { PermissionRequest, ToolGateResult } from '@tinytinkerer/app-core'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

// A permission request awaiting a human decision. `resolve` settles the promise
// returned by `requestPermission`; the entry is removed from the queue the moment
// it is called so the modal advances to the next pending request (if any).
export type PendingPermission = {
  id: string
  request: PermissionRequest
  resolve: (result: ToolGateResult) => void
}

type PermissionState = {
  queue: PendingPermission[]
}

// Module-level singleton, like the telemetry sink: the runtime factory wires a
// plain `requestPermission` function into the plugin host, while React surfaces
// subscribe to the same store to render the modal. Both sides share this one
// store so a tool gate raised deep in a runtime run reaches the mounted modal.
const permissionStore = createStore<PermissionState>(() => ({ queue: [] }))

let counter = 0

const removeFromQueue = (id: string): void => {
  permissionStore.setState((state) => ({
    queue: state.queue.filter((entry) => entry.id !== id)
  }))
}

// The PermissionRequestService implementation handed to the plugin host. Enqueues
// the request and resolves once the modal reports the user's choice. If no modal
// is mounted the promise never settles here; the runtime's hook timeout is the
// backstop (it denies the tool), so a host that forgets to render the modal fails
// safe rather than hanging forever.
export const requestPermission = (request: PermissionRequest): Promise<ToolGateResult> =>
  new Promise<ToolGateResult>((resolve) => {
    const id = `perm-${(counter += 1)}`
    const entry: PendingPermission = {
      id,
      request,
      resolve: (result) => {
        removeFromQueue(id)
        resolve(result)
      }
    }
    permissionStore.setState((state) => ({ queue: [...state.queue, entry] }))
  })

export const usePermissionStore = <T>(selector: (state: PermissionState) => T): T =>
  useStore(permissionStore, selector)

// Test seam: settle every pending request as denied and clear the queue so a
// test never leaks an unresolved permission promise between cases.
export const resetPermissionStore = (): void => {
  for (const entry of permissionStore.getState().queue) {
    entry.resolve({ allow: false, reason: 'cancelled' })
  }
  permissionStore.setState({ queue: [] })
}
