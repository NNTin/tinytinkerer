import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import process from 'node:process'

const DIRECT_SECTIONS = ['dependencies', 'devDependencies']
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const runPnpmList = () => {
  const output = execFileSync('pnpm', ['list', '-r', '--depth', '0', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(output)
}

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const rootDir = process.cwd()
const projects = runPnpmList()
let changed = 0
const unresolved = []

for (const project of projects) {
  const packageJsonPath = `${project.path}/package.json`
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  let projectChanged = false

  for (const section of DIRECT_SECTIONS) {
    const deps = packageJson[section]
    if (!deps) continue

    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier !== 'string') continue
      if (specifier.startsWith('workspace:')) continue
      if (EXACT_VERSION_RE.test(specifier)) continue

      const resolved = project[section]?.[name]
      const version = resolved?.version
      if (!version || !EXACT_VERSION_RE.test(version)) {
        unresolved.push(`${relative(rootDir, packageJsonPath)} ${section}.${name}=${specifier}`)
        continue
      }

      deps[name] = version
      projectChanged = true
    }
  }

  if (projectChanged) {
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    changed += 1
  }
}

if (unresolved.length > 0) {
  console.error('Could not resolve exact versions for:')
  for (const item of unresolved) console.error(`  - ${item}`)
  fail('run pnpm install/update first, then retry')
}

console.log(`Pinned direct dependency specifiers in ${changed} package.json file(s).`)
