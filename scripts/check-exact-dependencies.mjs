import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const DIRECT_SECTIONS = ['dependencies', 'devDependencies']
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const packageJsonFiles = execFileSync('git', ['ls-files', '*package.json'], {
  encoding: 'utf8'
})
  .trim()
  .split('\n')
  .filter(Boolean)

const violations = []

for (const file of packageJsonFiles) {
  const packageJson = JSON.parse(readFileSync(file, 'utf8'))
  for (const section of DIRECT_SECTIONS) {
    const deps = packageJson[section]
    if (!deps) continue
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier !== 'string') continue
      if (specifier.startsWith('workspace:')) continue
      if (!EXACT_VERSION_RE.test(specifier)) {
        violations.push(
          `${file}: ${section}.${name} must be exact, got ${JSON.stringify(specifier)}`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Non-exact direct dependency specifiers found:')
  for (const violation of violations) console.error(`  - ${violation}`)
  console.error(
    '\nRun `pnpm pin:dependencies` after updating dependencies, then commit the package.json changes.'
  )
  process.exit(1)
}

console.log(
  `All direct dependencies/devDependencies are exact in ${packageJsonFiles.length} package.json file(s).`
)
