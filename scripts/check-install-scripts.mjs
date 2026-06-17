import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const INSTALL_LIFECYCLES = ['preinstall', 'install', 'postinstall']

const pnpmJson = (args) => {
  const output = execFileSync('pnpm', [...args, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim()
  return output ? JSON.parse(output) : null
}

const getConfigArray = (name) => {
  const value = pnpmJson(['config', 'get', name])
  return Array.isArray(value) ? value : []
}

const collectInstalledPackages = () => {
  const output = execFileSync('pnpm', ['list', '-r', '--depth', 'Infinity', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // `pnpm list -r --depth Infinity` re-expands every shared subtree once per
    // workspace project, so the JSON dump scales with (packages × projects) and
    // is hundreds of MB even though the store is deduped. Size it generously so
    // adding a heavy dev dependency (e.g. vite-plugin-pwa across shells) doesn't
    // silently overflow the buffer and abort the supply-chain check.
    maxBuffer: 512 * 1024 * 1024
  })
  const projects = JSON.parse(output)
  const packages = new Map()

  const walk = (deps = {}) => {
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info.version !== 'string' || info.version.startsWith('link:')) continue
      const key = `${name}@${info.version}`
      if (!packages.has(key)) packages.set(key, { name, version: info.version, path: info.path })
      walk(info.dependencies)
      walk(info.devDependencies)
      walk(info.optionalDependencies)
    }
  }

  for (const project of projects) {
    walk(project.dependencies)
    walk(project.devDependencies)
    walk(project.optionalDependencies)
  }

  return [...packages.values()]
}

const reviewed = new Set([
  ...getConfigArray('onlyBuiltDependencies'),
  ...getConfigArray('ignoredBuiltDependencies')
])
const found = []

for (const pkg of collectInstalledPackages()) {
  if (!pkg.path) continue
  const packageJsonPath = `${pkg.path}/package.json`
  if (!existsSync(packageJsonPath)) continue
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const scripts = packageJson.scripts ?? {}
  const lifecycleScripts = INSTALL_LIFECYCLES.filter((script) => scripts[script])
  if (lifecycleScripts.length === 0) continue
  found.push({ ...pkg, scripts: lifecycleScripts })
}

const unreviewed = found.filter((pkg) => !reviewed.has(pkg.name))

if (unreviewed.length > 0) {
  console.error('Unreviewed dependency install lifecycle scripts found:')
  for (const pkg of unreviewed.sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
  )) {
    console.error(`  - ${pkg.name}@${pkg.version}: ${pkg.scripts.join(', ')}`)
  }
  console.error(
    '\nReview each package, then add its package name to onlyBuiltDependencies (approved to run) or ignoredBuiltDependencies (blocked) in pnpm-workspace.yaml.'
  )
  process.exit(1)
}

const reviewedWithScripts = [...new Set(found.map((pkg) => pkg.name))].sort()
console.log(
  reviewedWithScripts.length === 0
    ? 'No dependency install lifecycle scripts found.'
    : `All dependency install lifecycle scripts are reviewed: ${reviewedWithScripts.join(', ')}`
)
