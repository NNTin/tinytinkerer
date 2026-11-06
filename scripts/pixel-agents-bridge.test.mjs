import assert from 'node:assert/strict'
import test from 'node:test'
import {
  injectPixelAgentsBridge,
  PIXEL_AGENTS_BRIDGE_CHANNEL,
  renderPixelAgentsBridge
} from './pixel-agents-bridge.mjs'

test('Pixel Agents bridge is injected before the upstream module entry', () => {
  const output = injectPixelAgentsBridge(
    '<html><body><script type="module" crossorigin src="./assets/index.js"></script></body></html>'
  )
  assert.ok(
    output.indexOf('tinytinkerer-bridge.js') < output.indexOf('type="module"'),
    'bridge must replace WebSocket before the upstream module executes'
  )
})

test('Pixel Agents bridge scopes outbound messages to the integration channel', () => {
  const bridge = renderPixelAgentsBridge()
  assert.match(bridge, new RegExp(PIXEL_AGENTS_BRIDGE_CHANNEL.replaceAll(':', '\\:')))
  assert.match(bridge, /direction: 'client'/)
})

test('Pixel Agents bridge shims acquireVsCodeApi instead of WebSocket', () => {
  const bridge = renderPixelAgentsBridge()
  // Upstream feature-detects acquireVsCodeApi to pick its transport and to
  // decide whether to render its native "+ Agent" button (BottomToolbar.tsx).
  assert.match(bridge, /window\.acquireVsCodeApi = \(\) => \(/)
  assert.match(bridge, /postMessage: \(message\) => \{/)
  assert.match(bridge, /getState: \(\) => undefined/)
  assert.match(bridge, /setState: \(\) => \{\}/)
  assert.doesNotMatch(bridge, /window\.WebSocket/)
})

test('Pixel Agents bridge does not add an inbound listener of its own', () => {
  const bridge = renderPixelAgentsBridge()
  // Inbound (host -> iframe) messages are handled entirely by upstream's own
  // PostMessageTransport, once acquireVsCodeApi makes it the active
  // transport — the parent posts raw, unenveloped message objects directly,
  // matching what it expects.
  //
  // Named precisely rather than "no window listener at all": compact chrome
  // (issue #472) installs pointer/wheel blockers on window, and a blanket
  // assertion would have made adding them look like a violation of this rule.
  assert.doesNotMatch(bridge, /addEventListener\(\s*'message'/)
  assert.doesNotMatch(bridge, /envelope\.direction !== 'server'/)
})

test('Pixel Agents bridge sends outbound messages to the parent-origin query parameter', () => {
  const bridge = renderPixelAgentsBridge()
  assert.match(bridge, /tinytinkerer-parent-origin/)
  assert.match(bridge, /new URLSearchParams\(location\.search\)/)
  assert.match(bridge, /parentOrigin/)
})

test('Pixel Agents bridge drops outbound messages when no parent origin was supplied', () => {
  const bridge = renderPixelAgentsBridge()
  // Fail closed: standalone/no-query-param usage must not guess a targetOrigin.
  assert.match(bridge, /if \(!parentOrigin\) return/)
})

test('Pixel Agents bridge fails closed when upstream has no module entry', () => {
  assert.throws(() => injectPixelAgentsBridge('<html></html>'), /module entry script/)
})

test('Pixel Agents bridge is syntactically valid JavaScript', () => {
  // It is rendered as a template string and only ever executed inside the
  // sandboxed frame, where a syntax error would take the whole office down
  // with nothing on the host saying why.
  assert.doesNotThrow(() => new Function(renderPixelAgentsBridge()))
})

test('compact chrome is off unless the frame asked for it', () => {
  const bridge = renderPixelAgentsBridge()
  // One prepared bundle serves the product office, the live labs and the docs
  // sidebar, so every compact behaviour has to sit behind this one flag.
  assert.match(bridge, /const compactChrome = params\.get\('tinytinkerer-chrome'\) === 'compact'/)
  assert.match(bridge, /if \(compactChrome\) \{/)
})

test('compact chrome hides upstream zoom controls and blocks pan/zoom gestures', () => {
  const bridge = renderPixelAgentsBridge()
  // Buttons: the same title-selector technique as Settings, guarded against
  // upstream drift by check-pixel-agents-conformance.mjs.
  assert.match(bridge, /button\[title\^="Zoom "\]\{display:none!important\}/)
  // Gestures: capture phase, so upstream's own canvas listeners never run.
  // Non-passive, or preventDefault on wheel is ignored.
  assert.match(bridge, /addEventListener\('wheel', swallow, \{ capture: true, passive: false \}\)/)
  assert.match(bridge, /addEventListener\('mousedown', swallowMiddle, \{ capture: true \}\)/)
  assert.match(bridge, /addEventListener\('auxclick', swallowMiddle, \{ capture: true \}\)/)
  // Only the middle button: left selects a character, right erases in Layout
  // mode, and swallowing either would break the office rather than calm it.
  assert.match(bridge, /if \(event\.button === 1\)/)
})
