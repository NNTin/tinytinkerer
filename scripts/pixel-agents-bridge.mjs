export const PIXEL_AGENTS_BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'

export const renderPixelAgentsBridge = () => `(() => {
  const channel = ${JSON.stringify(PIXEL_AGENTS_BRIDGE_CHANNEL)}
  const sockets = new Set()
  // The parent embeds this document in a sandboxed ('allow-scripts', no
  // 'allow-same-origin') iframe, so it is served from an opaque origin here — the
  // parent's real origin cannot be read from location and cannot be named as a
  // postMessage targetOrigin. The parent instead passes its own origin once as a
  // query parameter when it navigates the frame. Absent that (e.g. this distribution
  // opened standalone, outside TinyTinkerer), fail closed: drop outbound messages
  // rather than guess an origin.
  const parentOrigin = new URLSearchParams(location.search).get('tinytinkerer-parent-origin')

  class TinyTinkererWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
      this.url = String(url)
      this.readyState = TinyTinkererWebSocket.CONNECTING
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      sockets.add(this)
      queueMicrotask(() => {
        if (this.readyState !== TinyTinkererWebSocket.CONNECTING) return
        this.readyState = TinyTinkererWebSocket.OPEN
        this.onopen?.(new Event('open'))
      })
    }

    send(payload) {
      if (this.readyState !== TinyTinkererWebSocket.OPEN) {
        throw new DOMException('WebSocket is not open', 'InvalidStateError')
      }
      if (!parentOrigin) return
      window.parent.postMessage(
        { channel, direction: 'client', payload: String(payload) },
        parentOrigin
      )
    }

    close() {
      if (this.readyState === TinyTinkererWebSocket.CLOSED) return
      this.readyState = TinyTinkererWebSocket.CLOSING
      sockets.delete(this)
      this.readyState = TinyTinkererWebSocket.CLOSED
      this.onclose?.(new Event('close'))
    }
  }

  window.addEventListener('message', (event) => {
    // location.origin is the opaque string "null" inside this sandboxed frame, and
    // the parent's real origin isn't statically knowable here, so identity is
    // checked by window reference (the only thing an opaque origin can't spoof)
    // rather than by origin string.
    if (event.source !== window.parent) return
    const envelope = event.data
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      envelope.channel !== channel ||
      envelope.direction !== 'server'
    ) return

    const data = JSON.stringify(envelope.message)
    for (const socket of sockets) {
      if (socket.readyState === TinyTinkererWebSocket.OPEN) {
        socket.onmessage?.(new MessageEvent('message', { data }))
      }
    }
  })

  window.WebSocket = TinyTinkererWebSocket

  const installIntegrationStyle = () => {
    const style = document.createElement('style')
    style.dataset.tinytinkererPixelAgents = 'true'
    // Only Settings stays hidden: it manages upstream (VS Code extension)
    // concerns the host owns here. "Close agent" was hidden too while the
    // office showed one hardcoded agent, but since issue #430 each character
    // is one conversation and the button's closeAgent message deletes it —
    // upstream's select-then-close two-step is the deliberate-interaction
    // guard for that.
    style.textContent = 'button[title="Settings"]{display:none!important}'
    document.head.append(style)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installIntegrationStyle, { once: true })
  } else {
    installIntegrationStyle()
  }
})()
`

export const injectPixelAgentsBridge = (html) => {
  const moduleScript = /<script\s+type=["']module["']/
  if (!moduleScript.test(html)) {
    throw new Error('Pixel Agents webview index does not contain a module entry script')
  }
  return html.replace(
    moduleScript,
    '<script src="./tinytinkerer-bridge.js"></script>\n    <script type="module"'
  )
}
