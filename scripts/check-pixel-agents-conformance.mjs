import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// These string literals are the discriminant `type` values of
// packages/app/pixel-agents/src/protocol.ts's PixelServerMessage/PixelClientMessage
// unions. The host hand-decodes upstream's postMessage traffic against that
// mirrored protocol; if upstream renames or drops one of these at a future pin,
// the bridge silently stops recognizing the message instead of failing loudly.
const REQUIRED_BUNDLE_STRINGS = [
  'providerCapabilities',
  'characterSpritesLoaded',
  'petSpritesLoaded',
  'floorTilesLoaded',
  'wallTilesLoaded',
  'furnitureAssetsLoaded',
  'existingAgents',
  'layoutLoaded',
  'settingsLoaded',
  'agentSelected',
  'agentStatus',
  'agentToolStart',
  'agentToolDone',
  'agentToolsClear',
  'webviewReady',
  'saveLayout',
  'saveAgentSeats',
  // The e2e suite (packages/e2e/tests/pixel-agents.e2e.ts) drives upstream
  // through these test hooks; if upstream renames/removes them the suite breaks
  // silently rather than failing the build.
  '__pixelAgentsTestHooks',
  '__PIXEL_AGENTS_E2E',
  // scripts/pixel-agents-animation-probe.mjs's consumer
  // (packages/e2e/fixtures/pixel-agents.ts's selectPersistentAgent) calls this
  // hook (testHooks.ts) to select the persistent agent without a canvas click.
  // Without it, selection is a silent no-op (officeState.selectedAgentId never
  // changes): no selection outline is ever drawn and the DOM overlay never
  // renders, so calibrateCharacterSlot() and agentOverlayLocator() would both
  // time out with nothing pointing at this hook as the cause.
  'selectAgent',
  // The data-testid value agentOverlayLocator() (packages/e2e/fixtures/pixel-agents.ts)
  // locates the activity overlay by (ToolOverlay.tsx) — upstream's own e2e technique.
  'agent-overlay',
  // The data-agent-id attribute agentOverlayLocator() filters that overlay by.
  'data-agent-id'
]

// scripts/pixel-agents-bridge.mjs implements only the on* handler properties of
// WebSocket (onopen/onmessage), not addEventListener. If upstream's webview
// switches to addEventListener-style wiring, the injected shim goes silently
// inert (no transport, no crash) instead of failing the build.
const REQUIRED_BUNDLE_PATTERNS = [
  { pattern: /new WebSocket\(/, description: 'a `new WebSocket(...)` construction' },
  { pattern: /\.onopen\s*=/, description: 'a `.onopen =` assignment' },
  { pattern: /\.onmessage\s*=/, description: 'a `.onmessage =` assignment' },
  // The injected CSS (scripts/pixel-agents-bridge.mjs) hides these buttons by
  // title attribute. The minifier emits them as template literals (title:`Settings`).
  {
    pattern: /title:\s*[`'"]Settings[`'"]/,
    description: 'a `title: `Settings`` (or quoted equivalent) button title'
  },
  {
    pattern: /title:\s*[`'"]Close agent[`'"]/,
    description: 'a `title: `Close agent`` (or quoted equivalent) button title'
  }
]

/**
 * Assert that the built webview bundle still contains the literal strings and
 * patterns that scripts/pixel-agents-bridge.mjs and
 * packages/app/pixel-agents/src/protocol.ts hand-mirror from upstream internals.
 *
 * This is not a general correctness check: it only guards the specific
 * assumptions this integration hard-codes, so that a future pin bump fails the
 * build loudly instead of silently breaking the visualization at runtime.
 *
 * @param {string} bundleSource concatenated content of all built `assets/*.js` files
 */
export const assertBundleConformance = (bundleSource) => {
  const missing = []

  for (const literal of REQUIRED_BUNDLE_STRINGS) {
    if (!bundleSource.includes(literal)) {
      missing.push(`string literal "${literal}"`)
    }
  }

  for (const { pattern, description } of REQUIRED_BUNDLE_PATTERNS) {
    if (!pattern.test(bundleSource)) {
      missing.push(`${description} (matching ${pattern})`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Pixel Agents bundle conformance check failed. The built webview bundle no longer ` +
        `contains:\n${missing.map((item) => `  - ${item}`).join('\n')}\n` +
        `upstream drifted at this pin; review packages/app/pixel-agents/src/protocol.ts, ` +
        `scripts/pixel-agents-bridge.mjs, and packages/e2e/tests/pixel-agents.e2e.ts before bumping`
    )
  }
}

/**
 * Resolve the npm package-lock.json (lockfileVersion 3, "packages" map) entry a
 * dependency named `name` resolves to when required from `fromKey`, following
 * Node's node_modules resolution (nearest node_modules wins, walking up toward
 * the workspace/package root). `fromKey` and map keys look like "webview-ui",
 * "node_modules/react", or "webview-ui/node_modules/react-dom".
 */
const resolvePackageKey = (packages, fromKey, name) => {
  const segments = fromKey ? fromKey.split('/node_modules/') : []
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const prefix = segments.slice(0, depth).join('/node_modules/')
    const candidate = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`
    if (Object.hasOwn(packages, candidate)) return candidate
  }
  return null
}

/**
 * Walk the production dependency closure of the webview-ui workspace, starting
 * from its own "dependencies" (never devDependencies), following each resolved
 * package's own "dependencies" transitively via npm's nearest-node_modules
 * resolution. Returns one entry per distinct package name reached.
 */
const collectWebviewProductionClosure = (lockfile) => {
  const packages = lockfile.packages ?? {}
  const root = packages['webview-ui']
  if (!root) {
    throw new Error('package-lock.json has no "webview-ui" workspace package entry')
  }

  /** @type {Map<string, { name: string, version: string, license: string }>} */
  const closure = new Map()
  const visitedKeys = new Set()
  const queue = [{ fromKey: 'webview-ui', deps: root.dependencies ?? {} }]

  while (queue.length > 0) {
    const { fromKey, deps } = queue.shift()
    for (const name of Object.keys(deps)) {
      const key = resolvePackageKey(packages, fromKey, name)
      if (!key || visitedKeys.has(key)) continue
      visitedKeys.add(key)

      const entry = packages[key]
      closure.set(name, {
        name,
        version: String(entry.version ?? ''),
        license: String(entry.license ?? 'UNKNOWN')
      })
      queue.push({ fromKey: key, deps: entry.dependencies ?? {} })
    }
  }

  return closure
}

/**
 * Assert that the committed config/pixel-agents-third-party.json manifest still
 * matches the actual (name, version, license) closure of what the webview bundle
 * ships: the pixel-agents project itself plus the production dependencies of its
 * webview-ui workspace. pnpm's own SBOM/notices tooling only sees TinyTinkerer's
 * lockfile, so this closure is otherwise invisible to compliance tooling.
 *
 * @param {string} checkoutDir path to the checked-out upstream commit
 * @param {Array<{ name: string, version: string, license: string }>} manifestEntries
 *   the committed config/pixel-agents-third-party.json contents
 */
export const assertThirdPartyManifest = async (checkoutDir, manifestEntries) => {
  const lockfile = JSON.parse(await readFile(join(checkoutDir, 'package-lock.json'), 'utf8'))
  const rootPackage = JSON.parse(await readFile(join(checkoutDir, 'package.json'), 'utf8'))
  const licenseText = await readFile(join(checkoutDir, 'LICENSE'), 'utf8')

  if (!licenseText.slice(0, 200).includes('MIT')) {
    throw new Error(
      'Pixel Agents third-party manifest check failed: the checkout LICENSE file no longer ' +
        'declares MIT in its first lines; review the new license before updating ' +
        'config/pixel-agents-third-party.json'
    )
  }

  const expected = new Map()
  expected.set(String(rootPackage.name), {
    name: String(rootPackage.name),
    version: String(rootPackage.version ?? ''),
    license: 'MIT'
  })
  for (const dep of collectWebviewProductionClosure(lockfile).values()) {
    expected.set(dep.name, dep)
  }

  const actual = new Map(manifestEntries.map((entry) => [entry.name, entry]))

  const mismatches = []
  for (const [name, dep] of expected) {
    const committed = actual.get(name)
    if (!committed) {
      mismatches.push(`missing from manifest: ${name}@${dep.version} (${dep.license})`)
    } else if (committed.version !== dep.version || committed.license !== dep.license) {
      mismatches.push(
        `${name}: manifest has ${committed.version} (${committed.license}), ` +
          `upstream now resolves ${dep.version} (${dep.license})`
      )
    }
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) {
      mismatches.push(`stale manifest entry no longer shipped: ${name}`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Pixel Agents third-party manifest is out of date:\n${mismatches.map((item) => `  - ${item}`).join('\n')}\n` +
        `Update config/pixel-agents-third-party.json after reviewing each package's license.`
    )
  }
}
