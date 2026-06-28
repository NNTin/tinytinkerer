import type { BridgeTransport } from './transport'

// The production transports that bind the bridge to the browser `postMessage`
// channel. The trust model mirrors app-browser's sandbox-executor.ts: the iframe
// runs at an opaque origin (sandbox="allow-scripts", no allow-same-origin), so
// `event.origin` is the string "null" and a literal origin allowlist is moot.
// Trust is therefore anchored on message *identity* — `event.source` must be the
// exact window we expect — here, and on the session nonce in the client/server.
// `targetOrigin: '*'` is safe because bridge payloads carry no harness secrets,
// only verb names and app data (the same rationale sandbox-executor.ts documents).

export type IframeClientTransportOptions = {
  // The window whose `message` events to listen on. Defaults to the global
  // `window`; injectable for tests.
  hostWindow?: Window
}

// Harness side: post to a specific iframe's contentWindow and accept only the
// messages that iframe sends back.
export const iframeClientTransport = (
  frame: Pick<HTMLIFrameElement, 'contentWindow'>,
  options: IframeClientTransportOptions = {}
): BridgeTransport => {
  const host = options.hostWindow ?? window
  return {
    post(message) {
      frame.contentWindow?.postMessage(message, '*')
    },
    subscribe(handler) {
      const listener = (event: MessageEvent): void => {
        // Identity check: only messages from this iframe's window are trusted.
        // Guard the null case explicitly — before the iframe is attached/loaded
        // `contentWindow` is null, and `event.source` is also null for messages
        // from non-window senders, so a bare `!==` would let those through.
        const target = frame.contentWindow
        if (!target || event.source !== target) return
        handler(event.data)
      }
      host.addEventListener('message', listener)
      return () => host.removeEventListener('message', listener)
    }
  }
}

export type ParentServerTransportOptions = {
  // The window the app runs in. Defaults to the global `window`; injectable for
  // tests. Its `.parent` is the harness window we post to and trust.
  appWindow?: Window
}

// App side: post to the parent (harness) window and accept only messages the
// parent sends.
export const parentServerTransport = (
  options: ParentServerTransportOptions = {}
): BridgeTransport => {
  const appWindow = options.appWindow ?? window
  const parentWindow = appWindow.parent
  return {
    post(message) {
      parentWindow.postMessage(message, '*')
    },
    subscribe(handler) {
      const listener = (event: MessageEvent): void => {
        // Identity check: only messages from the harness window are trusted.
        if (event.source !== parentWindow) return
        handler(event.data)
      }
      appWindow.addEventListener('message', listener)
      return () => appWindow.removeEventListener('message', listener)
    }
  }
}
