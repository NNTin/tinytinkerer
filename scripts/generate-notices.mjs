import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDependencyLicenses } from './lib/dependency-licenses.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(rootDir, process.env.NOTICES_OUTPUT ?? 'THIRD_PARTY_NOTICES.md')

const main = () => {
  const dependencies = collectDependencyLicenses()

  // Group packages by license so readers see the attribution at a glance.
  /** @type {Map<string, typeof dependencies>} */
  const byLicense = new Map()
  for (const dep of dependencies) {
    const bucket = byLicense.get(dep.license) ?? []
    bucket.push(dep)
    byLicense.set(dep.license, bucket)
  }

  const licenses = [...byLicense.keys()].sort((a, b) => a.localeCompare(b))

  const lines = [
    '# Third-Party Notices',
    '',
    'This project bundles or depends on the third-party software listed below. This',
    'file is a user-facing attribution summary, auto-generated from the production',
    'dependency tree by `scripts/generate-notices.mjs` — do not edit it by hand, and',
    'it is intentionally not committed to source control (see `.gitignore`).',
    '',
    'For machine-readable details, generate the SBOM with `pnpm compliance:sbom`.',
    '',
    `Generated on ${new Date().toISOString()} for ${dependencies.length} production dependencies.`,
    ''
  ]

  for (const license of licenses) {
    const packages = byLicense.get(license) ?? []
    lines.push(`## ${license}`, '')
    for (const dep of packages) {
      const version = dep.version ? `@${dep.version}` : ''
      const homepage = dep.homepage ? ` — ${dep.homepage}` : ''
      const author = dep.author ? ` (by ${dep.author})` : ''
      lines.push(`- **${dep.name}${version}**${author}${homepage}`)
    }
    lines.push('')
  }

  writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`)
  console.log(
    `Generated third-party notices for ${dependencies.length} dependencies at ${outputPath}`
  )
}

main()
