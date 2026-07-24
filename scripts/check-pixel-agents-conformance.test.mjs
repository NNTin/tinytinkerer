import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertBundleConformance,
  assertThirdPartyManifest
} from './check-pixel-agents-conformance.mjs'

const COMPLETE_BUNDLE =
  'type:"providerCapabilities" type:"characterSpritesLoaded" type:"petSpritesLoaded" ' +
  'type:"floorTilesLoaded" type:"wallTilesLoaded" type:"furnitureAssetsLoaded" ' +
  'type:"existingAgents" type:"layoutLoaded" type:"settingsLoaded" type:"agentSelected" ' +
  'type:"agentStatus" type:"agentToolStart" type:"agentToolDone" type:"agentToolsClear" ' +
  'type:"webviewReady" type:"saveLayout" type:"saveAgentSeats" ' +
  'window.__pixelAgentsTestHooks=1 window.__PIXEL_AGENTS_E2E=1 ' +
  'hooks.selectAgent=e "data-testid":"agent-overlay" "data-agent-id":t ' +
  'typeof acquireVsCodeApi ' +
  'title:`Settings` title:`Close agent`'

test('assertBundleConformance passes when every mirrored assumption is present', () => {
  assert.doesNotThrow(() => assertBundleConformance(COMPLETE_BUNDLE))
})

test('assertBundleConformance names each missing string literal', () => {
  const bundle = COMPLETE_BUNDLE.replace('type:"agentStatus" ', '')
  assert.throws(() => assertBundleConformance(bundle), /string literal "agentStatus"/)
})

test('assertBundleConformance names a missing acquireVsCodeApi feature-detection pattern', () => {
  const bundle = COMPLETE_BUNDLE.replace('typeof acquireVsCodeApi ', '')
  assert.throws(() => assertBundleConformance(bundle), /acquireVsCodeApi/)
})

test('assertBundleConformance names a missing button title pattern', () => {
  const bundle = COMPLETE_BUNDLE.replace('title:`Close agent`', '')
  assert.throws(() => assertBundleConformance(bundle), /Close agent/)
})

test('assertBundleConformance names a missing selectAgent test hook', () => {
  const bundle = COMPLETE_BUNDLE.replace('hooks.selectAgent=e ', '')
  assert.throws(() => assertBundleConformance(bundle), /string literal "selectAgent"/)
})

test('assertBundleConformance names a missing agent-overlay test id', () => {
  const bundle = COMPLETE_BUNDLE.replace('"data-testid":"agent-overlay" ', '')
  assert.throws(() => assertBundleConformance(bundle), /string literal "agent-overlay"/)
})

test('assertBundleConformance names a missing data-agent-id attribute', () => {
  const bundle = COMPLETE_BUNDLE.replace('"data-agent-id":t ', '')
  assert.throws(() => assertBundleConformance(bundle), /string literal "data-agent-id"/)
})

test('assertBundleConformance accepts single- and double-quoted title attributes', () => {
  const bundle = COMPLETE_BUNDLE.replace('title:`Settings`', "title: 'Settings'").replace(
    'title:`Close agent`',
    'title: "Close agent"'
  )
  assert.doesNotThrow(() => assertBundleConformance(bundle))
})

test('assertBundleConformance points reviewers at the mirrored files on failure', () => {
  assert.throws(
    () => assertBundleConformance(''),
    /protocol\.ts.*pixel-agents-bridge\.mjs.*pixel-agents\.e2e\.ts/s
  )
})

/** Build a synthetic npm lockfile (v3 "packages" shape) for a workspace. */
const fakeLockfile = ({ webviewDeps, extraPackages = {} }) => ({
  lockfileVersion: 3,
  packages: {
    'webview-ui': { version: '0.0.0', dependencies: webviewDeps },
    ...extraPackages
  }
})

let checkoutDir

test.beforeEach(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), 'pixel-agents-conformance-test-'))
})

test.afterEach(async () => {
  await rm(checkoutDir, { recursive: true, force: true })
})

const writeCheckout = async (
  dir,
  { rootPackage, lockfile, license = 'MIT License\n\nCopyright...' }
) => {
  await writeFile(join(dir, 'package.json'), JSON.stringify(rootPackage))
  await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lockfile))
  await writeFile(join(dir, 'LICENSE'), license)
}

test('assertThirdPartyManifest passes when the manifest matches the resolved closure', async () => {
  const lockfile = fakeLockfile({
    webviewDeps: { react: '^19.0.0', 'react-dom': '^19.0.0' },
    extraPackages: {
      'webview-ui/node_modules/react': { version: '19.2.6', license: 'MIT' },
      'webview-ui/node_modules/react-dom': {
        version: '19.2.6',
        license: 'MIT',
        dependencies: { scheduler: '^0.27.0' }
      },
      'webview-ui/node_modules/scheduler': { version: '0.27.0', license: 'MIT' }
    }
  })
  await writeCheckout(checkoutDir, {
    rootPackage: { name: 'pixel-agents', version: '1.3.0' },
    lockfile
  })

  await assert.doesNotReject(() =>
    assertThirdPartyManifest(checkoutDir, [
      { name: 'pixel-agents', version: '1.3.0', license: 'MIT' },
      { name: 'react', version: '19.2.6', license: 'MIT' },
      { name: 'react-dom', version: '19.2.6', license: 'MIT' },
      { name: 'scheduler', version: '0.27.0', license: 'MIT' }
    ])
  )
})

test('assertThirdPartyManifest resolves a dependency hoisted to the workspace root over a differently-versioned sibling', async () => {
  const lockfile = fakeLockfile({
    webviewDeps: { 'react-dom': '^19.0.0' },
    extraPackages: {
      // Nothing nested under react-dom's own node_modules: resolution must walk
      // up to the workspace-hoisted scheduler, not some unrelated root copy.
      'webview-ui/node_modules/react-dom': {
        version: '19.2.6',
        license: 'MIT',
        dependencies: { scheduler: '^0.27.0' }
      },
      'webview-ui/node_modules/scheduler': { version: '0.27.0', license: 'MIT' },
      'node_modules/scheduler': { version: '0.23.2', license: 'MIT' }
    }
  })
  await writeCheckout(checkoutDir, {
    rootPackage: { name: 'pixel-agents', version: '1.3.0' },
    lockfile
  })

  await assert.doesNotReject(() =>
    assertThirdPartyManifest(checkoutDir, [
      { name: 'pixel-agents', version: '1.3.0', license: 'MIT' },
      { name: 'react-dom', version: '19.2.6', license: 'MIT' },
      { name: 'scheduler', version: '0.27.0', license: 'MIT' }
    ])
  )
})

test('assertThirdPartyManifest throws on a version drift with an actionable message', async () => {
  const lockfile = fakeLockfile({
    webviewDeps: { react: '^19.0.0' },
    extraPackages: {
      'webview-ui/node_modules/react': { version: '19.9.9', license: 'MIT' }
    }
  })
  await writeCheckout(checkoutDir, {
    rootPackage: { name: 'pixel-agents', version: '1.3.0' },
    lockfile
  })

  await assert.rejects(
    () =>
      assertThirdPartyManifest(checkoutDir, [
        { name: 'pixel-agents', version: '1.3.0', license: 'MIT' },
        { name: 'react', version: '19.2.6', license: 'MIT' }
      ]),
    /react: manifest has 19\.2\.6.*upstream now resolves 19\.9\.9.*config\/pixel-agents-third-party\.json/s
  )
})

test('assertThirdPartyManifest throws on a stale manifest entry no longer shipped', async () => {
  const lockfile = fakeLockfile({ webviewDeps: {} })
  await writeCheckout(checkoutDir, {
    rootPackage: { name: 'pixel-agents', version: '1.3.0' },
    lockfile
  })

  await assert.rejects(
    () =>
      assertThirdPartyManifest(checkoutDir, [
        { name: 'pixel-agents', version: '1.3.0', license: 'MIT' },
        { name: 'left-pad', version: '1.0.0', license: 'MIT' }
      ]),
    /stale manifest entry no longer shipped: left-pad/
  )
})

test('assertThirdPartyManifest throws when the checkout LICENSE no longer declares MIT', async () => {
  const lockfile = fakeLockfile({ webviewDeps: {} })
  await writeCheckout(checkoutDir, {
    rootPackage: { name: 'pixel-agents', version: '1.3.0' },
    lockfile,
    license: 'GNU GENERAL PUBLIC LICENSE\nVersion 3'
  })

  await assert.rejects(
    () => assertThirdPartyManifest(checkoutDir, []),
    /LICENSE file no longer declares MIT/
  )
})
