import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

// Regroup the Allure "Suites" tab into a small, fixed set of top-level buckets
// (frontend / backend / core / plugins / shared / e2e) by REWRITING the suite
// labels of every merged `*-result.json` BEFORE `allure generate` runs in the
// report job of .github/workflows/deploy-pages.yml (issue #260, follow-up to #258).
//
// Why a pipeline pass and not a config toggle: Allure builds the Suites tree purely
// from the labels `parentSuite → suite → subSuite → test`, baked in at generate time.
// allure-vitest sets parentSuite = the top `describe()` name (~100 distinct values)
// and allure-playwright sets it = the project name (the browser), so the tab's top
// level is a flat ~100-row mix with chromium/firefox/webkit buried among them.
// Allure 2 (allure-commandline 2.42) has no UI regroup, so we relabel the results.
//
// For each result we derive its workspace package, map the package's DIRECTORY to a
// bucket (path-driven, so new packages bucket automatically), and rewrite:
//   parentSuite = bucket          (e.g. frontend)
//   suite       = package         (e.g. @tinytinkerer/web)
//   subSuite    = original parentSuite (the describe name, or the browser for e2e)
// All other labels are untouched — notably the per-test browser/shard `tag`s (#258).
//
// Runs over both the vitest and e2e result dirs (pass them as args, mirroring
// `allure generate dir1 dir2 …`). Every step degrades gracefully so it also runs
// locally for the PR's `allure generate` verification without the CI context.

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')

// The fixed set of Suites top-level buckets. Anything that matches no path rule
// lands in DEFAULT_BUCKET and is logged, so an unmapped new package is VISIBLE in
// the warnings rather than silently mis-bucketed.
export const DEFAULT_BUCKET = 'shared'
export const BUCKETS = new Set(['frontend', 'backend', 'core', 'plugins', 'shared', 'e2e'])

// Ordered, most-specific-first rules mapping a package's workspace-relative dir to a
// bucket. The two `packages/app/*` and two `packages/shared/*` rules encode the
// within-directory SPLITS (a pure top-level prefix is not enough): app-browser is a
// frontend runtime while agent-core/app-core are core; ui ships to the frontend while
// contracts/sentry-telemetry are shared. The remaining prefix rules pick up new
// packages added under those trees automatically.
const BUCKET_RULES = [
  // packages/app/* split
  [/^packages\/app\/app-browser$/, 'frontend'],
  [/^packages\/app\/(agent-core|app-core)$/, 'core'],
  // packages/shared/* split
  [/^packages\/shared\/ui$/, 'frontend'],
  [/^packages\/shared\/(contracts|sentry-telemetry)$/, 'shared'],
  // directory-prefix rules (most-specific app match first)
  [/^packages\/e2e$/, 'e2e'],
  [/^packages\/plugins\//, 'plugins'],
  [/^packages\/content\//, 'frontend'],
  [/^packages\/brand\//, 'frontend'],
  [/^apps\/edge$/, 'backend'],
  [/^apps\//, 'frontend']
]

/**
 * Map a workspace-relative package directory (e.g. `packages/shared/contracts`) to a
 * bucket. Unmapped dirs return DEFAULT_BUCKET and invoke `onUnmapped(dir)` so the
 * caller can log the fallback once per package.
 */
export const bucketForDir = (dir, onUnmapped) => {
  const norm = dir.replaceAll('\\', '/')
  for (const [pattern, bucket] of BUCKET_RULES) {
    if (pattern.test(norm)) return bucket
  }
  onUnmapped?.(norm)
  return DEFAULT_BUCKET
}

/**
 * Derive the workspace package name for a result. Vitest's `fullName` is prefixed
 * `@scope/pkg:relative/path#…`, so the `:`-prefix is tried first; Playwright's
 * `fullName` is `relative/path:line:col` (no package prefix), so we fall back to the
 * `package` label (`@scope/pkg.relative.path`, emitted by BOTH reporters) and match
 * the longest known package name that is a `.`-segment prefix of it. Returns null
 * when nothing matches a known package.
 */
export const derivePackageName = (result, knownPackages) => {
  const fullName = typeof result.fullName === 'string' ? result.fullName : ''
  const colon = fullName.indexOf(':')
  if (colon > 0) {
    const candidate = fullName.slice(0, colon)
    if (knownPackages.has(candidate)) return candidate
  }
  const packageLabel = result.labels?.find((label) => label.name === 'package')?.value
  if (packageLabel) {
    let best = null
    for (const name of knownPackages) {
      if (packageLabel === name || packageLabel.startsWith(`${name}.`)) {
        if (!best || name.length > best.length) best = name
      }
    }
    if (best) return best
  }
  return null
}

const SUITE_LABELS = new Set(['parentSuite', 'suite', 'subSuite'])

/**
 * True when a result's labels already carry the regrouped shape (parentSuite is a
 * bucket name AND suite is exactly the package name). Original reporter output never
 * matches both — a vitest/playwright `suite` is a nested-describe name, never a
 * package name — so this makes a re-run a no-op rather than overwriting subSuite with
 * the bucket name.
 */
export const isAlreadyRegrouped = (labels, packageName) => {
  const parentSuite = labels.find((label) => label.name === 'parentSuite')?.value
  const suite = labels.find((label) => label.name === 'suite')?.value
  return suite === packageName && BUCKETS.has(parentSuite)
}

/**
 * Rewrite the suite labels of one result's label array. Returns a NEW array with
 * every parentSuite/suite/subSuite dropped and the regrouped trio appended:
 * parentSuite=bucket, suite=package, subSuite=the original parentSuite (when any).
 * All non-suite labels (package, framework, tag, host, thread, …) are preserved.
 */
export const regroupLabels = (labels, { bucket, packageName }) => {
  const originalParentSuite = labels.find((label) => label.name === 'parentSuite')?.value
  const kept = labels.filter((label) => !SUITE_LABELS.has(label.name))
  kept.push({ name: 'parentSuite', value: bucket })
  kept.push({ name: 'suite', value: packageName })
  if (originalParentSuite) {
    kept.push({ name: 'subSuite', value: originalParentSuite })
  }
  return kept
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', '.vercel'])

/** Recursively collect every package.json under `apps/` and `packages/`. */
const findPackageJsons = async (dir) => {
  const found = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'package.json') {
      found.push(join(dir, entry.name))
      continue
    }
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
    found.push(...(await findPackageJsons(join(dir, entry.name))))
  }
  return found
}

/**
 * Build a Map of workspace package name → workspace-relative dir (posix) by globbing
 * the package.json files, so packages added later are picked up automatically.
 */
const buildPackageDirMap = async () => {
  const map = new Map()
  for (const root of ['apps', 'packages']) {
    for (const file of await findPackageJsons(join(workspaceRoot, root))) {
      try {
        const pkg = JSON.parse(await readFile(file, 'utf8'))
        if (pkg.name) {
          map.set(pkg.name, relative(workspaceRoot, dirname(file)).split(sep).join('/'))
        }
      } catch {
        // A package.json that doesn't parse can't be bucketed; skip it.
      }
    }
  }
  return map
}

/** Process every `*-result.json` in `targetDir`, rewriting suite labels in place. */
const regroupDir = async (targetDir, packageDirMap, knownPackages, unmappedPackages) => {
  let entries
  try {
    entries = await readdir(targetDir, { withFileTypes: true })
  } catch {
    console.warn(`regroup-allure-suites: results dir not found, skipping: ${targetDir}`)
    return { rewritten: 0, skipped: 0 }
  }

  let rewritten = 0
  let skipped = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('-result.json')) continue
    const file = join(targetDir, entry.name)
    let result
    try {
      result = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      console.warn(`regroup-allure-suites: could not parse, skipping: ${entry.name}`)
      skipped += 1
      continue
    }
    if (!Array.isArray(result.labels)) result.labels = []

    const resolved = derivePackageName(result, knownPackages)
    if (!resolved) {
      console.warn(
        `regroup-allure-suites: no workspace package for "${result.fullName ?? result.name}", leaving labels unchanged`
      )
      skipped += 1
      continue
    }

    // Idempotent: skip a result that's already regrouped (e.g. a re-run) so subSuite
    // isn't overwritten with the bucket name.
    if (isAlreadyRegrouped(result.labels, resolved)) {
      skipped += 1
      continue
    }

    const dir = packageDirMap.get(resolved)
    const bucket = bucketForDir(dir, (unmappedDir) => {
      if (!unmappedPackages.has(resolved)) {
        unmappedPackages.add(resolved)
        console.warn(
          `regroup-allure-suites: package ${resolved} (${unmappedDir}) matched no bucket rule; ` +
            `falling back to "${DEFAULT_BUCKET}" — add a rule in scripts/regroup-allure-suites.mjs`
        )
      }
    })

    result.labels = regroupLabels(result.labels, { bucket, packageName: resolved })
    await writeFile(file, `${JSON.stringify(result)}\n`)
    rewritten += 1
  }
  return { rewritten, skipped }
}

// Only run the file walk / IO when executed as a script (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirArgs = process.argv.slice(2)
  const targets = (dirArgs.length > 0 ? dirArgs : ['allure-results-vitest']).map((dir) =>
    resolve(workspaceRoot, dir)
  )

  const packageDirMap = await buildPackageDirMap()
  const knownPackages = new Set(packageDirMap.keys())
  const unmappedPackages = new Set()
  let totalRewritten = 0
  let totalSkipped = 0
  for (const target of targets) {
    const { rewritten, skipped } = await regroupDir(
      target,
      packageDirMap,
      knownPackages,
      unmappedPackages
    )
    totalRewritten += rewritten
    totalSkipped += skipped
  }

  console.log(
    `regroup-allure-suites: rewrote ${totalRewritten} result file(s)` +
      (totalSkipped > 0 ? `, skipped ${totalSkipped}` : '') +
      ` across ${targets.length} dir(s)`
  )
}
