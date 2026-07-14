import assert from 'node:assert/strict'
import test from 'node:test'
import {
  injectPixelAgentsAnimationProbe,
  renderPixelAgentsAnimationProbe
} from './pixel-agents-animation-probe.mjs'
import { injectPixelAgentsBridge } from './pixel-agents-bridge.mjs'

test('Pixel Agents animation probe is inert unless window.__PIXEL_AGENTS_E2E is true', () => {
  const probe = renderPixelAgentsAnimationProbe()
  // The flag is checked at INSTALL time (top of the IIFE), before any
  // prototype is touched — production and normal dev usage never even reach
  // the patching code below this line.
  assert.match(probe, /if \(window\.__PIXEL_AGENTS_E2E !== true\) return/)
})

test('Pixel Agents animation probe patches drawImage and fillRect', () => {
  const probe = renderPixelAgentsAnimationProbe()
  assert.match(probe, /CanvasRenderingContext2D\.prototype\.drawImage = function/)
  assert.match(probe, /CanvasRenderingContext2D\.prototype\.fillRect = function/)
})

test('Pixel Agents animation probe exposes window.__ttAnimationProbe', () => {
  const probe = renderPixelAgentsAnimationProbe()
  assert.match(probe, /window\.__ttAnimationProbe = \{/)
  assert.match(probe, /drawLog: \(\)/)
  assert.match(probe, /totals: \(\)/)
  assert.match(probe, /reset: \(\)/)
})

test('Pixel Agents animation probe fails closed when upstream has no module entry', () => {
  assert.throws(() => injectPixelAgentsAnimationProbe('<html></html>'), /module entry script/)
})

test('Pixel Agents bridge, then animation probe compose in the correct injection order', () => {
  const withBridge = injectPixelAgentsBridge(
    '<html><body><script type="module" crossorigin src="./assets/index.js"></script></body></html>'
  )
  const output = injectPixelAgentsAnimationProbe(withBridge)

  const bridgeIndex = output.indexOf('tinytinkerer-bridge.js')
  const probeIndex = output.indexOf('tinytinkerer-animation-probe.js')
  const moduleIndex = output.indexOf('type="module"')

  assert.ok(bridgeIndex >= 0, 'bridge script tag missing from composed output')
  assert.ok(probeIndex >= 0, 'probe script tag missing from composed output')
  assert.ok(moduleIndex >= 0, 'module entry script tag missing from composed output')
  assert.ok(
    bridgeIndex < probeIndex && probeIndex < moduleIndex,
    'expected injection order bridge -> probe -> module entry'
  )
})
