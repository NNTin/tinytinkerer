import { collectDependencyLicenses } from './lib/dependency-licenses.mjs'
import { evaluateLicense, VERDICT } from './license-policy.mjs'

const main = () => {
  const dependencies = collectDependencyLicenses()

  const violations = []
  const warnings = []
  const review = []

  for (const dep of dependencies) {
    const verdict = evaluateLicense(dep.license)
    const label = `${dep.name}@${dep.version || '?'} (${dep.license})`

    if (verdict === VERDICT.BLOCK) {
      violations.push(label)
    } else if (verdict === VERDICT.WARN) {
      warnings.push(label)
    } else if (verdict === VERDICT.REVIEW) {
      review.push(label)
    }
  }

  if (warnings.length) {
    console.warn('⚠️  License warnings (restricted, but tolerated):')
    warnings.forEach((w) => console.warn(`   - ${w}`))
  }

  if (review.length) {
    console.warn('⚠️  Unrecognized licenses (needs manual review):')
    review.forEach((r) => console.warn(`   - ${r}`))
  }

  if (violations.length) {
    console.error('❌ License violations detected (blocked by policy):')
    violations.forEach((v) => console.error(`   - ${v}`))
    console.error(
      `\n${violations.length} blocked dependenc${violations.length === 1 ? 'y' : 'ies'} found.`
    )
    process.exit(1)
  }

  console.log(
    `✅ License check passed for ${dependencies.length} production dependencies` +
      `${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}` +
      `${review.length ? `, ${review.length} needing review` : ''}.`
  )
}

main()
