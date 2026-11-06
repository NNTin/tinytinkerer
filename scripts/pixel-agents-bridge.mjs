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
  const params = new URLSearchParams(location.search)
  const parentOrigin = params.get('tinytinkerer-parent-origin')

  // How much room the host has (issue #472). Set by the stage when a host asks
  // for \`chrome="compact"\` (packages/app/pixel-agents/src/pixel-agents-stage.tsx);
  // absent for every other embedding, which keeps their frame URL and behaviour
  // byte-identical to before. One prepared upstream bundle serves them all, so
  // this has to be decided per frame rather than at build time.
  const compactChrome = params.get('tinytinkerer-chrome') === 'compact'

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
    let css = 'button[title="Settings"]{display:none!important}'
    if (compactChrome) {
      // Upstream's ZoomControls (webview-ui/src/components/ZoomControls.tsx)
      // are two round buttons pinned top-left, which in a ~300px column sit on
      // top of the office itself. Hidden by title, the same technique and the
      // same drift risk as Settings above — scripts/check-pixel-agents-conformance.mjs
      // fails the build if upstream stops emitting these titles. The "3x" level
      // indicator needs no rule: it only appears when the zoom value CHANGES,
      // and in compact chrome nothing can change it.
      css += 'button[title^="Zoom "]{display:none!important}'
    }
    style.textContent = css
    document.head.append(style)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installIntegrationStyle, { once: true })
  } else {
    installIntegrationStyle()
  }

  // Pan and zoom are GESTURES as well as buttons: upstream's OfficeCanvas
  // handles plain wheel / two-finger as pan, Ctrl+wheel as zoom, and
  // middle-mouse drag as pan. Hiding the buttons alone would leave a reader
  // able to scroll the room out of view with no visible way back — worse than
  // leaving zoom in. These listeners run in the CAPTURE phase on window, so
  // they settle the event before it reaches the canvas listeners upstream
  // installs on the element itself; upstream's own code is untouched.
  //
  // \`preventDefault\` needs a non-passive wheel listener, which has to be
  // requested explicitly since browsers default window-level wheel to passive.
  if (compactChrome) {
    const swallow = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('wheel', swallow, { capture: true, passive: false })
    // Button 1 is the middle button. Left (0) and right (2) must keep working:
    // they select a character and, in Layout mode, paint and erase tiles.
    const swallowMiddle = (event) => {
      if (event.button === 1) swallow(event)
    }
    window.addEventListener('mousedown', swallowMiddle, { capture: true })
    window.addEventListener('auxclick', swallowMiddle, { capture: true })
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
