import { collectDependencyLicenses } from './lib/dependency-licenses.mjs'
import {
  evaluateLicense,
  VERDICT,
  REVIEWED_LICENSE_EXCEPTIONS
} from './license-policy.mjs'

const main = () => {
  const dependencies = collectDependencyLicenses()

  const violations = []
  const warnings = []
  const acknowledged = []
  const unreviewed = []

  for (const dep of dependencies) {
    const verdict = evaluateLicense(dep.license)
    const label = `${dep.name}@${dep.version || '?'} (${dep.license})`

    if (verdict === VERDICT.BLOCK) {
      violations.push(label)
    } else if (verdict === VERDICT.WARN) {
      warnings.push(label)
    } else if (verdict === VERDICT.REVIEW) {
      // An unrecognized license only passes if it has been explicitly reviewed
      // and recorded in the baseline; anything else fails the gate so unknown
      // licenses can't slip through unnoticed.
      if (
        Object.prototype.hasOwnProperty.call(
          REVIEWED_LICENSE_EXCEPTIONS,
          dep.name
        )
      ) {
        acknowledged.push(`${label} — ${REVIEWED_LICENSE_EXCEPTIONS[dep.name]}`)
      } else {
        unreviewed.push(label)
      }
    }
  }

  if (warnings.length) {
    console.warn('⚠️  License warnings (restricted, but tolerated):')
    warnings.forEach((w) => console.warn(`   - ${w}`))
  }

  if (acknowledged.length) {
    console.warn('ℹ️  Unrecognized licenses (manually reviewed and accepted):')
    acknowledged.forEach((a) => console.warn(`   - ${a}`))
  }

  if (unreviewed.length) {
    console.error('❌ Unrecognized licenses with no recorded review:')
    unreviewed.forEach((r) => console.error(`   - ${r}`))
    console.error(
      '   Resolve each one, then add it to REVIEWED_LICENSE_EXCEPTIONS in scripts/license-policy.mjs.'
    )
  }

  if (violations.length) {
    console.error('❌ License violations detected (blocked by policy):')
    violations.forEach((v) => console.error(`   - ${v}`))
  }

  const blockingCount = violations.length + unreviewed.length
  if (blockingCount) {
    console.error(
      `\n${blockingCount} dependenc${blockingCount === 1 ? 'y' : 'ies'} must be resolved before the compliance gate can pass.`
    )
    process.exit(1)
  }

  console.log(
    `✅ License check passed for ${dependencies.length} production dependencies` +
      `${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}` +
      `${acknowledged.length ? `, ${acknowledged.length} reviewed exception${acknowledged.length === 1 ? '' : 's'}` : ''}.`
  )
}

main()
