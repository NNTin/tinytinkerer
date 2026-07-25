import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  assertBundleConformance,
  assertThirdPartyManifest
} from './check-pixel-agents-conformance.mjs'
import {
  injectPixelAgentsAnimationProbe,
  renderPixelAgentsAnimationProbe
} from './pixel-agents-animation-probe.mjs'
import { injectPixelAgentsBridge, renderPixelAgentsBridge } from './pixel-agents-bridge.mjs'
import { patchBottomToolbarSource } from './pixel-agents-source-patch.mjs'

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
  join(workspaceRoot, 'scripts', 'pixel-agents-animation-probe.mjs'),
  join(workspaceRoot, 'scripts', 'pixel-agents-source-patch.mjs'),
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
  const required = [
    'index.html',
    'tinytinkerer-bridge.js',
    'tinytinkerer-animation-probe.js',
    'tinytinkerer-bootstrap.json'
  ]
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

const isUpToDate = async () => {
  if (process.env.TINYTINKERER_PIXEL_AGENTS_FORCE === '1') return false
  const existingStamp = await readFile(stampPath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null)
  return Boolean(
    existingStamp && deepEqual(existingStamp, expectedStamp) && (await stagedArtifactsPresent())
  )
}

// turbo runs multiple build tasks in parallel (e.g. the docs and
// pixel-agents-shell packages), and each shells out to this script as a
// pre-step. Without serializing them, two invocations both delete and
// recreate `destination` at once, tearing the directory out from under each
// other (ENOTEMPTY on rmdir, ENOENT reading the files below). The lock forces
// concurrent invocations to run one at a time; the up-to-date check is
// repeated once the lock is held so the loser of the race just skips instead
// of redoing the (expensive) build.
const lockPath = join(dirname(destination), '.prepare-pixel-agents.lock')
const LOCK_POLL_MS = 250
// Generous relative to a from-scratch build (git fetch + npm ci + vite build
// of the upstream webview): long enough that a slow-but-live build is never
// mistaken for abandoned, short enough that a killed process (CI timeout,
// SIGKILL) doesn't wedge every future run behind a dead lock forever.
const LOCK_STALE_MS = 20 * 60 * 1000
const LOCK_TIMEOUT_MS = 30 * 60 * 1000

const acquireLock = async () => {
  await mkdir(dirname(lockPath), { recursive: true })
  const start = Date.now()
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`)
      } finally {
        await handle.close()
      }
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const lockAgeMs = await stat(lockPath)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => Infinity)
      if (lockAgeMs > LOCK_STALE_MS) {
        await rm(lockPath, { force: true })
        continue
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for prepare-pixel-agents lock at ${lockPath}`)
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, LOCK_POLL_MS))
    }
  }
}

const releaseLock = () => rm(lockPath, { force: true })

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const prepare = async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'tinytinkerer-pixel-agents-'))

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

    // Source-level patch, applied to the pinned checkout BEFORE the build runs
    // (unlike the bridge/probe injections below, which rewrite the already-built
    // output): drops the "Skip permissions mode" dead-end dropdown from
    // upstream's "+ Agent" button. See pixel-agents-source-patch.mjs for why
    // this can't be done as a post-build CSS/DOM injection.
    const bottomToolbarPath = join(checkout, 'webview-ui', 'src', 'components', 'BottomToolbar.tsx')
    await writeFile(
      bottomToolbarPath,
      patchBottomToolbarSource(await readFile(bottomToolbarPath, 'utf8'))
    )

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
    // Chained AFTER the bridge injector so the final script order is
    // bridge -> probe -> module entry (the probe's own test asserts this order).
    await writeFile(indexPath, injectPixelAgentsAnimationProbe(injectPixelAgentsBridge(index)))
    await writeFile(join(destination, 'tinytinkerer-bridge.js'), renderPixelAgentsBridge())
    await writeFile(
      join(destination, 'tinytinkerer-animation-probe.js'),
      renderPixelAgentsAnimationProbe()
    )

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
}

if (await isUpToDate()) {
  console.log(`Pixel Agents ${lock.commit} is up to date, skipping prepare`)
} else {
  await acquireLock()
  try {
    if (await isUpToDate()) {
      console.log(
        `Pixel Agents ${lock.commit} is up to date, skipping prepare (built by a concurrent invocation)`
      )
    } else {
      await prepare()
    }
  } finally {
    await releaseLock()
  }
}
