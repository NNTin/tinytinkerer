export const PIXEL_AGENTS_BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'

export const renderPixelAgentsBridge = () => `(() => {
  const channel = ${JSON.stringify(PIXEL_AGENTS_BRIDGE_CHANNEL)}
  const sockets = new Set()

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
      window.parent.postMessage(
        { channel, direction: 'client', payload: String(payload) },
        window.location.origin
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
    if (event.source !== window.parent || event.origin !== window.location.origin) return
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
    style.textContent =
      'button[title="Settings"],button[title="Close agent"]{display:none!important}'
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
