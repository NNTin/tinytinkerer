/**
 * The package acceptance run (issue #510, T1).
 *
 *   node acceptance/run.mjs                          # the local build, packed
 *   node acceptance/run.mjs --from-registry <ver>    # a published version
 *
 * Proves the acceptance criterion from the outside: a FRESH npm project —
 * `acceptance/host/`, which has nothing but an `.npmrc` for GitHub Packages,
 * pinned React, and its own toolchain — installs the package, typechecks
 * against its published declarations with `skipLibCheck: false`, and builds.
 * The built page is written to `acceptance/.output/dist`, where the Playwright
 * spec `packages/e2e/tests/embed-package.e2e.ts` serves it and drives a chat
 * turn that calls the host's Zod-schema tool.
 *
 * It also asserts the install itself: the host's production dependency tree
 * must be the package, React, and React's own runtime dependency — nothing
 * else the package might have leaked.
 *
 * And it measures what the host pays at startup (issue #518, F3): the host's
 * entry imports `@nntin/tinytinkerer-embed/oauth` EAGERLY, so the gzipped
 * startup JavaScript — the entry script and every chunk index.html preloads —
 * must stay React plus a few kilobytes. One static import from the package
 * root would add the whole runtime (CanFactory measured +437 KB gz).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const acceptanceDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(acceptanceDir, '..')
const outputDir = join(acceptanceDir, '.output/dist')
const PACKAGE_NAME = '@nntin/tinytinkerer-embed'

/** The host's whole production tree. `scheduler` is react-dom's own dependency. */
const ALLOWED_PRODUCTION_PACKAGES = new Set([PACKAGE_NAME, 'react', 'react-dom', 'scheduler'])

// The host's gzipped startup JavaScript, measured when written: 62.0 KB, almost
// all of it React and react-dom (pinned in host/package.json, so it is stable);
// the `/oauth` subpath is ~1 KB of it. How much a root import adds depends on
// the host's bundler and on WHICH export: CanFactory (Rollup) measured +437 KB
// for one constant, and here (Vite 8 / Rolldown, which splits the package's
// chunks finer) importing `DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES` from the root
// measured 73.9 KB. The budget sits between baseline and that smallest leak.
const STARTUP_GZIP_BUDGET_BYTES = 66_000

const args = process.argv.slice(2)
const registryIndex = args.indexOf('--from-registry')
const registryVersion = registryIndex === -1 ? undefined : args[registryIndex + 1]
if (registryIndex !== -1 && !registryVersion) {
  console.error('--from-registry needs a version')
  process.exit(2)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (command, commandArgs, cwd, { capture = false } = {}) => {
  console.log(`[acceptance] ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    env: {
      ...process.env,
      // The .npmrc reads it; a local-tarball run never contacts GitHub
      // Packages, so any value will do there. A registry run needs a real one.
      NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN ?? 'unused-for-a-local-tarball'
    }
  })
  if (result.status !== 0) {
    console.error(`[acceptance] failed: ${command} ${commandArgs.join(' ')}`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const workDir = mkdtempSync(join(tmpdir(), 'tt-embed-acceptance-'))
try {
  let packageSpec = registryVersion
  if (!packageSpec) {
    const stageDir = join(workDir, 'stage')
    run(process.execPath, [join(packageDir, 'scripts/stage-package.mjs'), stageDir], packageDir)
    run(npm, ['pack', '--pack-destination', workDir], stageDir)
    const tarball = readdirSync(workDir).find((name) => name.endsWith('.tgz'))
    if (!tarball) {
      throw new Error('npm pack produced no tarball')
    }
    packageSpec = `file:${join(workDir, tarball)}`
  }

  const hostDir = join(workDir, 'host')
  cpSync(join(acceptanceDir, 'host'), hostDir, {
    recursive: true,
    filter: (source) => !/[/\\](node_modules|dist)$/.test(source)
  })
  const hostManifestPath = join(hostDir, 'package.json')
  const hostManifest = JSON.parse(readFileSync(hostManifestPath, 'utf8'))
  // The template pins an exact version (the workspace requires exact specifiers);
  // the run always replaces it with the tarball or the requested version.
  hostManifest.dependencies[PACKAGE_NAME] = packageSpec
  writeFileSync(hostManifestPath, `${JSON.stringify(hostManifest, null, 2)}\n`)

  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], hostDir)

  // Nothing but the package and React may land in the host's production tree.
  const tree = JSON.parse(
    run(npm, ['ls', '--omit=dev', '--all', '--json'], hostDir, { capture: true })
  )
  const installed = new Set()
  const collect = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      installed.add(name)
      collect(child)
    }
  }
  collect(tree)
  const leaked = [...installed].filter((name) => !ALLOWED_PRODUCTION_PACKAGES.has(name))
  if (leaked.length > 0) {
    console.error(
      `[acceptance] the package leaked runtime dependencies into the host: ${leaked.join(', ')}`
    )
    process.exit(1)
  }
  console.log(`[acceptance] host production tree: ${[...installed].sort().join(', ')}`)

  run(npm, ['run', 'typecheck'], hostDir)
  run(npm, ['run', 'build'], hostDir)

  // What the built host loads before any import() runs: the entry script and
  // every chunk index.html preloads with it.
  const hostDist = join(hostDir, 'dist')
  const indexHtml = readFileSync(join(hostDist, 'index.html'), 'utf8')
  const startupScripts = [
    ...indexHtml.matchAll(/<script type="module"[^>]*\ssrc="([^"]+)"/g),
    ...indexHtml.matchAll(/<link rel="modulepreload"[^>]*\shref="([^"]+)"/g)
  ].map((match) => match[1])
  if (startupScripts.length === 0) {
    console.error('[acceptance] found no entry script in the built index.html')
    process.exit(1)
  }
  const startupGzipBytes = startupScripts.reduce(
    (sum, src) => sum + gzipSync(readFileSync(join(hostDist, src))).length,
    0
  )
  console.log(
    `[acceptance] host startup JavaScript (${startupScripts.join(', ')}): ` +
      `${(startupGzipBytes / 1000).toFixed(1)} kB gzip`
  )
  if (startupGzipBytes > STARTUP_GZIP_BUDGET_BYTES) {
    console.error(
      `[acceptance] the host's startup JavaScript is ${startupGzipBytes} bytes gzipped, over the ` +
        `${STARTUP_GZIP_BUDGET_BYTES}-byte budget: the eager \`/oauth\` import pulled in the runtime`
    )
    process.exit(1)
  }

  rmSync(outputDir, { recursive: true, force: true })
  cpSync(join(hostDir, 'dist'), outputDir, { recursive: true })
  console.log(`[acceptance] host built; served from ${outputDir}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
