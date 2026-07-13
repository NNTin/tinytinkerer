import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
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
  await cp(join(checkout, 'LICENSE'), join(destination, 'PIXEL_AGENTS_LICENSE.txt'))

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

  await writeFile(
    join(destination, 'TINYTINKERER_UPSTREAM.json'),
    JSON.stringify({ repository: lock.repository, commit: lock.commit }, null, 2) + '\n'
  )
  console.log(`Prepared Pixel Agents ${lock.commit} in ${destination}`)
} finally {
  await rm(checkout, { recursive: true, force: true })
}
