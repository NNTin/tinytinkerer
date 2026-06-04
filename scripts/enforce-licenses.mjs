import { collectDependencyLicenses } from './lib/dependency-licenses.mjs'
import { evaluateLicense, VERDICT } from './license-policy.mjs'

const main = () => {
  const dependencies = collectDependencyLicenses()

  const violations = []
  const warnings = []
  const unrecognized = []

  for (const dep of dependencies) {
    const verdict = evaluateLicense(dep.license)
    const label = `${dep.name}@${dep.version || '?'} (${dep.license})`

    if (verdict === VERDICT.BLOCK) {
      violations.push(label)
    } else if (verdict === VERDICT.WARN) {
      warnings.push(label)
    } else if (verdict === VERDICT.UNKNOWN) {
      // Unrecognized / undefined / missing license — always fails the gate.
      unrecognized.push(label)
    }
  }

  if (warnings.length) {
    console.warn('⚠️  License warnings (restricted, but tolerated):')
    warnings.forEach((w) => console.warn(`   - ${w}`))
  }

  if (unrecognized.length) {
    console.error('❌ Unrecognized or undefined licenses (must be classified):')
    unrecognized.forEach((u) => console.error(`   - ${u}`))
    console.error(
      '   Classify each in LICENSE_POLICY (scripts/license-policy.mjs). If a package\n' +
        '   reports no/incorrect license, correct it via LICENSE_OVERRIDES\n' +
        '   (scripts/lib/dependency-licenses.mjs) after verifying its real license.'
    )
  }

  if (violations.length) {
    console.error('❌ License violations detected (blocked by policy):')
    violations.forEach((v) => console.error(`   - ${v}`))
  }

  const blockingCount = violations.length + unrecognized.length
  if (blockingCount) {
    console.error(
      `\n${blockingCount} dependenc${blockingCount === 1 ? 'y' : 'ies'} must be resolved before the compliance gate can pass.`
    )
    process.exit(1)
  }

  console.log(
    `✅ License check passed for ${dependencies.length} production dependencies` +
      `${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`
  )
}

main()
