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

test('Pixel Agents bridge scopes both directions to the same integration channel and origin', () => {
  const bridge = renderPixelAgentsBridge()
  assert.match(bridge, new RegExp(PIXEL_AGENTS_BRIDGE_CHANNEL.replaceAll(':', '\\:')))
  assert.match(bridge, /window\.location\.origin/)
  assert.match(bridge, /event\.source !== window\.parent/)
  assert.match(bridge, /direction: 'client'/)
  assert.match(bridge, /envelope\.direction !== 'server'/)
})

test('Pixel Agents bridge fails closed when upstream has no module entry', () => {
  assert.throws(() => injectPixelAgentsBridge('<html></html>'), /module entry script/)
})
