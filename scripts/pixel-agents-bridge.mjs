export const PIXEL_AGENTS_BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'

export const renderPixelAgentsBridge = () => `(() => {
  const channel = ${JSON.stringify(PIXEL_AGENTS_BRIDGE_CHANNEL)}
  // The parent embeds this document in a sandboxed ('allow-scripts', no
  // 'allow-same-origin') iframe, so it is served from an opaque origin here — the
  // parent's real origin cannot be read from location and cannot be named as a
  // postMessage targetOrigin. The parent instead passes its own origin once as a
  // query parameter when it navigates the frame. Absent that (e.g. this distribution
  // opened standalone, outside TinyTinkerer), fail closed: drop outbound messages
  // rather than guess an origin.
  const parentOrigin = new URLSearchParams(location.search).get('tinytinkerer-parent-origin')

  // Upstream feature-detects a VS Code webview host via \`typeof acquireVsCodeApi\`
  // (webview-ui/src/runtime.ts) to pick its message transport, and to decide
  // whether to render its native "+ Agent" button (webview-ui/src/components/
  // BottomToolbar.tsx). Defining this global makes upstream treat this
  // embedding as a VS Code webview: outbound messages go through
  // acquireVsCodeApi().postMessage(message) (below, called exactly once, at
  // module load, from transport/index.ts), and inbound messages are handled
  // entirely by upstream's own PostMessageTransport (a plain "message" event
  // listener it installs itself) — so this bridge does not need to listen
  // for inbound messages itself; the parent posts raw (unenveloped) message
  // objects directly to this frame.
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => {
      if (!parentOrigin) return
      window.parent.postMessage(
        { channel, direction: 'client', payload: JSON.stringify(message) },
        parentOrigin
      )
    },
    // Unused anywhere in webview-ui today (grepped); stubbed for forward-compat
    // with the real VS Code webview API shape.
    getState: () => undefined,
    setState: () => {}
  })

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
