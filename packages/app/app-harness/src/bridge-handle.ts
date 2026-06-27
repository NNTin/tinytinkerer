import type { BridgeClient } from '@tinytinkerer/app-bridge'

export type AppBridgeStatus = 'pending' | 'ready' | 'unavailable'

// The product-agnostic, typed replacement for the discarded same-tree
// `canvas-bridge` module singleton. The shell creates ONE handle and passes it to
// both `appToolsFromVerbs` (so the always-on tools, built at bootstrap, can close
// over it) and `<AppFrame>` (which populates it with the live bridge client once
// the iframe app completes its handshake). The tools call `request`, which rejects
// with an actionable message until the app is ready — so the model never hangs on
// a verb issued before the app finished loading, and degrades cleanly on a version
// mismatch or load failure.
export type AppBridgeHandle = {
  // Called by <AppFrame> when the bridge becomes ready (client) or tears down (null).
  setClient(client: BridgeClient | null): void
  // Called by <AppFrame> when the app can't be driven (version mismatch / load
  // failure). Subsequent requests reject with `reason`.
  setUnavailable(reason: string): void
  getStatus(): AppBridgeStatus
  // Forward a verb to the app. Used by the always-on appTools.
  request(verb: string, payload?: unknown): Promise<unknown>
}

export const createAppBridgeHandle = (): AppBridgeHandle => {
  let client: BridgeClient | null = null
  let status: AppBridgeStatus = 'pending'
  let unavailableReason = ''

  return {
    setClient(next) {
      client = next
      status = next ? 'ready' : 'pending'
      if (next) unavailableReason = ''
    },
    setUnavailable(reason) {
      client = null
      status = 'unavailable'
      unavailableReason = reason
    },
    getStatus() {
      return status
    },
    request(verb, payload) {
      if (status === 'unavailable') {
        return Promise.reject(new Error(`app-harness: app is unavailable — ${unavailableReason}`))
      }
      if (!client) {
        return Promise.reject(
          new Error(`app-harness: cannot run "${verb}" before the app finishes loading`)
        )
      }
      return client.request(verb, payload)
    }
  }
}
