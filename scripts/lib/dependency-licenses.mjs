import { execFileSync } from 'node:child_process'

/**
 * Corrected licenses for packages whose published metadata is missing or wrong,
 * keyed by the exact `name@version` so a correction is scoped to the version we
 * actually verified. A future version that changes (or fixes) its metadata will
 * NOT silently inherit the old override — it falls through to its real reported
 * license and, if still unrecognized, re-fails the gate for a fresh review.
 *
 * Each entry must be verified against that version's own source/repository —
 * this is for fixing bad metadata, NOT for waiving the policy: an unrecognized
 * license still fails the gate unless it is corrected to a real SPDX id here.
 */
export const LICENSE_OVERRIDES = {
  // khroma@2.1.0 ships no `license` field in its package.json, so pnpm reports it
  // as Unknown. Its repository declares MIT.
  // https://github.com/fabiospampinato/khroma#readme
  'khroma@2.1.0': 'MIT'
}

/**
 * Collect production dependency license metadata straight from pnpm.
 *
 * We deliberately use pnpm's own `licenses list` instead of npm-oriented tools
 * (license-checker, cyclonedx-npm): those read npm's nested node_modules and
 * return almost nothing against pnpm's symlinked `.pnpm` store. pnpm understands
 * its own workspace + lockfile, so this is the reliable single source of truth
 * for the SBOM, the THIRD_PARTY_NOTICES file, and the license-policy gate.
 *
 * @returns {Array<{ name: string, version: string, license: string, author: string, homepage: string, description: string }>}
 *   One entry per resolved (name, version), sorted by name then version.
 */
export const collectDependencyLicenses = () => {
  // -P limits the output to production dependencies (the ones we actually ship
  // and therefore must attribute). --json groups packages by license string.
  const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '-P'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })

  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const grouped = JSON.parse(raw)

  /** @type {Map<string, { name: string, version: string, license: string, author: string, homepage: string, description: string }>} */
  const byKey = new Map()

  for (const [licenseKey, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      const name = String(entry.name ?? '').trim()
      if (!name) continue

      const reportedLicense = normalizeLicense(String(entry.license ?? licenseKey ?? 'Unknown'))
      const versions = Array.isArray(entry.versions) ? entry.versions : []
      const author = typeof entry.author === 'string' ? entry.author : ''
      const homepage = typeof entry.homepage === 'string' ? entry.homepage : ''
      const description = typeof entry.description === 'string' ? entry.description : ''

      // Notably absent: pnpm's `paths` field. It contains absolute machine paths
      // (…/node_modules/.pnpm/…) which must never leak into committed or shared
      // artifacts, so we drop it here at the boundary.
      for (const version of versions.length > 0 ? versions : ['']) {
        const key = `${name}@${version}`
        if (byKey.has(key)) continue
        // A verified, version-scoped override wins over pnpm's reported license so
        // packages with missing/incorrect metadata (e.g. khroma@2.1.0) are
        // categorized correctly, without affecting other versions of the package.
        const license = LICENSE_OVERRIDES[key] ?? reportedLicense
        byKey.set(key, { name, version: String(version), license, author, homepage, description })
      }
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  )
}

/** Collapse pnpm's "Unknown" sentinel and blank values to a single token. */
const normalizeLicense = (license) => {
  const trimmed = license.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return 'UNKNOWN'
  return trimmed
}
