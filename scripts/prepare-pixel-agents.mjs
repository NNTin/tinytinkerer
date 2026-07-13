import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  assertBundleConformance,
  assertThirdPartyManifest
} from './check-pixel-agents-conformance.mjs'
import { injectPixelAgentsBridge, renderPixelAgentsBridge } from './pixel-agents-bridge.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')
const lock = JSON.parse(
  await readFile(join(workspaceRoot, 'config', 'pixel-agents-upstream.json'), 'utf8')
)

if (
  typeof lock.repository !== 'string' ||
  typeof lock.commit !== 'string' ||
  !/^[0-9a-f]{40}$/.test(lock.commit)
) {
  throw new Error('config/pixel-agents-upstream.json must contain a repository and full commit SHA')
}

const destination = join(workspaceRoot, 'apps', 'pixel-agents', 'generated', 'upstream')
const stampPath = join(destination, 'TINYTINKERER_UPSTREAM.json')

// The stamp also covers our own scripts (not just the upstream pin): a change
// to the bridge shim, the asset builder, or the conformance gate itself must
// re-run prepare even though the pinned commit didn't move.
const CONFORMANCE_SCRIPT_PATH = join(workspaceRoot, 'scripts', 'check-pixel-agents-conformance.mjs')
const STAMPED_SCRIPT_PATHS = [
  join(workspaceRoot, 'scripts', 'prepare-pixel-agents.mjs'),
  join(workspaceRoot, 'scripts', 'pixel-agents-bridge.mjs'),
  join(workspaceRoot, 'scripts', 'build-pixel-agents-assets.mjs'),
  CONFORMANCE_SCRIPT_PATH
]

const computeScriptsHash = async () => {
  const hash = createHash('sha256')
  for (const path of STAMPED_SCRIPT_PATHS) {
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

const expectedStamp = {
  repository: lock.repository,
  commit: lock.commit,
  scriptsHash: await computeScriptsHash()
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The stamp alone is not proof the staged output survived (a partial clean can
// delete artifacts but keep the stamp), so the skip also requires the files
// every consumer depends on.
const stagedArtifactsPresent = async () => {
  const required = ['index.html', 'tinytinkerer-bridge.js', 'tinytinkerer-bootstrap.json']
  const checks = await Promise.all(
    required.map((name) =>
      readFile(join(destination, name)).then(
        () => true,
        () => false
      )
    )
  )
  return checks.every(Boolean)
}

if (process.env.TINYTINKERER_PIXEL_AGENTS_FORCE !== '1') {
  const existingStamp = await readFile(stampPath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null)

  if (
    existingStamp &&
    deepEqual(existingStamp, expectedStamp) &&
    (await stagedArtifactsPresent())
  ) {
    console.log(`Pixel Agents ${lock.commit} is up to date, skipping prepare`)
    process.exit(0)
  }
}

const checkout = await mkdtemp(join(tmpdir(), 'tinytinkerer-pixel-agents-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const run = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? checkout,
      env: { ...process.env, CI: '1', ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    })
    let stdout = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(stdout.trim())
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })

try {
  await run('git', ['init', '--quiet'])
  await run('git', ['remote', 'add', 'origin', lock.repository])
  await run('git', ['fetch', '--quiet', '--depth=1', 'origin', lock.commit])
  await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
  const resolvedCommit = await run('git', ['rev-parse', 'HEAD'], { capture: true })
  if (resolvedCommit !== lock.commit) {
    throw new Error(`Pixel Agents resolved to ${resolvedCommit}, expected ${lock.commit}`)
  }

  // Install only the browser workspace. Lifecycle scripts remain disabled; the
  // reviewed webview build below is the sole upstream script we execute.
  await run(npm, [
    'ci',
    '--workspace',
    'webview-ui',
    '--include-workspace-root=false',
    '--include=dev',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund'
  ])
  await run(npm, ['run', 'build', '--workspace', 'webview-ui'])

  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await cp(join(checkout, 'dist', 'webview'), destination, { recursive: true })

  const indexPath = join(destination, 'index.html')
  const index = await readFile(indexPath, 'utf8')
  await writeFile(indexPath, injectPixelAgentsBridge(index))
  await writeFile(join(destination, 'tinytinkerer-bridge.js'), renderPixelAgentsBridge())

  const tsx = join(
    checkout,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  )
  await run(
    tsx,
    [
      join(workspaceRoot, 'scripts', 'build-pixel-agents-assets.mjs'),
      checkout,
      join(destination, 'tinytinkerer-bootstrap.json'),
      lock.commit
    ],
    { cwd: checkout }
  )

  // Guards the hand-mirrored couplings to upstream internals (message protocol,
  // WebSocket handler shape, hidden-button titles, e2e test hooks) before we
  // ever consider this prepare successful — a silent drift here breaks the
  // visualization at runtime instead of failing here, at build time.
  const assetsDir = join(destination, 'assets')
  const assetFiles = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'))
  let bundleSource = ''
  for (const name of assetFiles) {
    bundleSource += await readFile(join(assetsDir, name), 'utf8')
  }
  assertBundleConformance(bundleSource)

  const thirdPartyManifest = JSON.parse(
    await readFile(join(workspaceRoot, 'config', 'pixel-agents-third-party.json'), 'utf8')
  )
  await assertThirdPartyManifest(checkout, thirdPartyManifest)

  // Written LAST, only after every step above (including the conformance gate)
  // succeeded: a failed run must never leave a valid "up to date" stamp behind.
  await writeFile(stampPath, JSON.stringify(expectedStamp, null, 2) + '\n')
  console.log(`Prepared Pixel Agents ${lock.commit} in ${destination}`)
} finally {
  await rm(checkout, { recursive: true, force: true })
}
