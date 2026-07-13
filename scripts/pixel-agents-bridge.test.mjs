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

test('Pixel Agents bridge scopes both directions to the same integration channel', () => {
  const bridge = renderPixelAgentsBridge()
  assert.match(bridge, new RegExp(PIXEL_AGENTS_BRIDGE_CHANNEL.replaceAll(':', '\\:')))
  assert.match(bridge, /event\.source !== window\.parent/)
  assert.match(bridge, /direction: 'client'/)
  assert.match(bridge, /envelope\.direction !== 'server'/)
})

test('Pixel Agents bridge inbound check is source-identity only, not origin', () => {
  const bridge = renderPixelAgentsBridge()
  // The frame is sandboxed to an opaque origin, so location.origin is "null" and the
  // parent's real origin can't be checked from inside; window identity is the only
  // spoof-proof signal available here.
  assert.doesNotMatch(bridge, /event\.origin/)
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
