// @ts-check

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { DOCS_SITE_SPEC, HOSTED_APP_SPECS } from './app-definitions.mjs'

const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultWorkspaceRoot = resolve(currentDir, '../../..')

/**
 * Compose every independently-built frontend into the directory Vercel serves.
 *
 * @param {{
 *   workspaceRoot?: string,
 *   deployBase?: string,
 *   testReportDir?: string
 * }} [options]
 */
export const composeFrontend = async ({
  workspaceRoot = defaultWorkspaceRoot,
  deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '') ?? '',
  testReportDir = process.env.TINYTINKERER_TEST_REPORT_DIR?.trim() ?? ''
} = {}) => {
  // PR deploy previews compose a merged Allure test report (vitest + e2e) into the
  // deployment so it ships at <preview>/test-report/. Develop and production
  // deploys leave the option unset, so the report is preview-only.
  const hostDistDir = join(workspaceRoot, 'apps/host/dist')
  // The root composition app builds to apps/host/dist-root (base '/'); it becomes
  // the site root. Kept separate from dist so the two never collide.
  const hostRootDistDir = join(workspaceRoot, 'apps/host/dist-root')
  await rm(hostDistDir, { recursive: true, force: true })
  await mkdir(hostDistDir, { recursive: true })

  await cp(hostRootDistDir, hostDistDir, { recursive: true })
  for (const { slug, source } of HOSTED_APP_SPECS) {
    // `host` is the root app already copied above; the others mount under /<slug>/.
    if (slug === 'host') continue

    const target = join(hostDistDir, slug)
    await mkdir(target, { recursive: true })
    // The web/widget/mobile mounts all copy from the single apps/shell build;
    // integrated apps copy their own builds.
    await cp(join(workspaceRoot, 'apps', source, 'dist'), target, { recursive: true })
  }

  const docsTarget = join(hostDistDir, DOCS_SITE_SPEC.slug)
  await mkdir(docsTarget, { recursive: true })
  await cp(
    join(workspaceRoot, 'apps', DOCS_SITE_SPEC.source, DOCS_SITE_SPEC.outputDir),
    docsTarget,
    { recursive: true }
  )

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

  return { composedReport, hostDistDir }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await composeFrontend()
}
