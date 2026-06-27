import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { HOSTED_APP_SPECS } from './app-definitions.mjs'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(currentDir, '../../..')
const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')

// PR deploy previews compose a merged Allure test report (vitest + e2e) into the
// deployment so it ships at <preview>/test-report/. The deploy-preview job points
// TINYTINKERER_TEST_REPORT_DIR at the generated static report; develop and
// production deploys leave it unset, so the report is preview-only. A missing or
// empty directory is skipped (not fatal) so a failed report job can never break the
// frontend build.
const testReportDir = process.env.TINYTINKERER_TEST_REPORT_DIR?.trim()

const hostDistDir = join(workspaceRoot, 'apps/host/dist')
const hostPublicDir = join(workspaceRoot, 'apps/host/public')
await rm(hostDistDir, { recursive: true, force: true })
await mkdir(hostDistDir, { recursive: true })

await cp(hostPublicDir, hostDistDir, { recursive: true })
for (const { slug } of HOSTED_APP_SPECS) {
  const target = join(hostDistDir, slug)
  await mkdir(target, { recursive: true })
  await cp(join(workspaceRoot, 'apps', slug, 'dist'), target, { recursive: true })
}

let composedReport = false
if (testReportDir) {
  const resolvedReportDir = resolve(workspaceRoot, testReportDir)
  const reportStat = await stat(resolvedReportDir).catch(() => null)
  if (reportStat?.isDirectory()) {
    const target = join(hostDistDir, 'test-report')
    await mkdir(target, { recursive: true })
    await cp(resolvedReportDir, target, { recursive: true })
    composedReport = true
  } else {
    console.warn(
      `TINYTINKERER_TEST_REPORT_DIR is set to "${testReportDir}" but no directory was found there; skipping /test-report/.`
    )
  }
}

console.log(
  `Composed frontend bundles into apps/host/dist${deployBase ? ` for ${deployBase}` : ''}${composedReport ? ' (with /test-report/)' : ''}`
)
