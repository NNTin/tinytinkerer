import { readFile } from 'node:fs/promises'
import process from 'node:process'

// Security audit of the locked dependency tree against npm's bulk advisory
// endpoint. This replaces `pnpm audit --audit-level=moderate` in CI: npm retired
// the full-audit endpoint pnpm posts to (it now answers 410 "use the bulk
// advisory endpoint instead"), and as of pnpm 11 no released pnpm speaks the
// bulk protocol. The gate is unchanged in spirit: fail on any advisory of
// moderate or higher severity affecting an installed version, unless its GHSA id
// is allow-listed in pnpm-workspace.yaml (auditConfig.ignoreGhsas — the same
// list `pnpm audit` consumed, kept in sync with the Dependency Review config by
// scripts/check-advisory-allowlists.mjs).
//
// The bulk endpoint takes `{ "<name>": ["<version>", ...] }` and returns only
// advisories relevant to the versions submitted, so no client-side semver range
// evaluation is needed (matching npm CLI behavior, which relies on the same
// server-side filtering).

const BULK_ADVISORY_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
const FAILING_SEVERITIES = new Set(['moderate', 'high', 'critical'])
// Names per request. The endpoint accepts large bodies, but chunking keeps any
// single failure small and the requests comfortably under proxy body limits.
const CHUNK_SIZE = 200

const readAllowlistedGhsas = (workspaceSource) => {
  const lines = workspaceSource.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === 'ignoreGhsas:')
  if (start < 0) return new Set()
  const indentation = lines[start].search(/\S/)
  const values = new Set()
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (line.search(/\S/) <= indentation) break
    const match = line.trim().match(/^-\s+(GHSA-[a-z0-9-]+)$/i)
    if (match?.[1]) values.add(match[1].toUpperCase())
  }
  return values
}

// pnpm-lock.yaml v9: the `packages:` section keys every resolved package as
// `name@version:` (optionally quoted; peer-dependency suffixes only appear in
// the `snapshots:` section, so keys here are plain versions). link:/file:
// specifiers never appear in `packages:`, so everything collected is a registry
// package the advisory database can know about.
const collectLockedPackages = (lockfileSource) => {
  const lines = lockfileSource.split(/\r?\n/)
  const start = lines.findIndex((line) => line === 'packages:')
  if (start < 0) throw new Error('pnpm-lock.yaml: missing packages section')
  const packages = new Map()
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    if (!line.startsWith('  ')) break
    const match = line.match(/^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@([^':\s]+)'?:$/)
    if (!match) continue
    const [, name, version] = match
    if (!packages.has(name)) packages.set(name, new Set())
    packages.get(name).add(version)
  }
  if (packages.size === 0) throw new Error('pnpm-lock.yaml: no packages parsed')
  return packages
}

const fetchAdvisories = async (entries) => {
  const body = Object.fromEntries(entries.map(([name, versions]) => [name, [...versions]]))
  const response = await fetch(BULK_ADVISORY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`Bulk advisory endpoint responded with ${response.status}`)
  }
  return response.json()
}

const [lockfileSource, workspaceSource] = await Promise.all([
  readFile('pnpm-lock.yaml', 'utf8'),
  readFile('pnpm-workspace.yaml', 'utf8')
])
const allowlisted = readAllowlistedGhsas(workspaceSource)
const packages = collectLockedPackages(lockfileSource)

const entries = [...packages.entries()]
const findings = []
const skipped = []
for (let index = 0; index < entries.length; index += CHUNK_SIZE) {
  const advisoriesByName = await fetchAdvisories(entries.slice(index, index + CHUNK_SIZE))
  for (const [name, advisories] of Object.entries(advisoriesByName)) {
    for (const advisory of advisories ?? []) {
      // The bulk response carries the GHSA id only inside the advisory URL
      // (`https://github.com/advisories/GHSA-…`); `id` is a numeric database key.
      const ghsa = (String(advisory.url ?? '').match(/GHSA-[a-z0-9-]+/i)?.[0] ?? '').toUpperCase()
      // Unknown severities fail the gate: a malformed advisory must never
      // silently pass a security check.
      const severity = String(advisory.severity ?? 'unknown').toLowerCase()
      if (FAILING_SEVERITIES.has(severity) || !['low', 'info'].includes(severity)) {
        const finding = {
          name,
          ghsa: ghsa || `advisory ${advisory.id ?? '?'}`,
          severity,
          title: advisory.title ?? '(untitled advisory)',
          url: advisory.url ?? '(no advisory url)',
          range: advisory.vulnerable_versions ?? '?',
          versions: [...(packages.get(name) ?? [])].join(', ')
        }
        if (allowlisted.has(ghsa)) skipped.push(finding)
        else findings.push(finding)
      }
    }
  }
}

for (const finding of skipped) {
  console.log(
    `allow-listed: ${finding.ghsa} ${finding.severity} — ${finding.name} (${finding.range})`
  )
}
if (findings.length > 0) {
  console.error(`\n${findings.length} advisory finding(s) of moderate or higher severity:`)
  for (const finding of findings) {
    console.error(
      [
        `- ${finding.ghsa} [${finding.severity}] ${finding.name}`,
        `  ${finding.title}`,
        `  vulnerable: ${finding.range}; installed: ${finding.versions}`,
        `  ${finding.url}`
      ].join('\n')
    )
  }
  console.error(
    '\nFix by upgrading the affected package, or allow-list the GHSA id in ' +
      'pnpm-workspace.yaml (auditConfig.ignoreGhsas) AND ' +
      '.github/dependency-review-config.yml with a reviewed justification.'
  )
  process.exit(1)
}

console.log(
  `Advisory audit passed: ${packages.size} packages checked, ` +
    `${skipped.length} allow-listed advisory finding(s) skipped.`
)
