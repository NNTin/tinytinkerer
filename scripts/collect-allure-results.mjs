import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

// Consolidate every package's `allure-results/` (written by the allure-vitest
// reporter under `pnpm test:allure`, one dir per workspace package) into a single
// directory so the deploy-preview report job can upload it as one artifact and feed
// it to `allure generate` alongside the e2e results (issue #254).
//
// Allure result/container/attachment files are UUID-named so they never collide;
// the only fixed-name files (categories.json, environment.properties) are identical
// across packages, so a last-writer-wins copy is fine. packages/e2e is skipped —
// its Playwright results come from a separate job/artifact.

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')

const target = resolve(workspaceRoot, process.argv[2] ?? 'allure-results-vitest')

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', '.vercel'])
const e2eDir = join(workspaceRoot, 'packages', 'e2e')

/** Recursively find every directory named `allure-results`, skipping build/vendor trees and packages/e2e. */
const findResultDirs = async (dir) => {
  const found = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (full === e2eDir) continue
    if (entry.name === 'allure-results') {
      found.push(full)
      continue
    }
    if (IGNORED_DIRS.has(entry.name)) continue
    found.push(...(await findResultDirs(full)))
  }
  return found
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

const resultDirs = await findResultDirs(workspaceRoot)
let fileCount = 0
for (const dir of resultDirs) {
  const files = await readdir(dir, { withFileTypes: true })
  for (const file of files) {
    if (!file.isFile()) continue
    await cp(join(dir, file.name), join(target, file.name))
    fileCount += 1
  }
}

const printable = relative(workspaceRoot, target) || target
console.log(
  `Collected ${fileCount} Allure result file(s) from ${resultDirs.length} package dir(s) into ${printable}`
)
