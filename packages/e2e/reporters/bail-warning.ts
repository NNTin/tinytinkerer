import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter'
import { appendFileSync } from 'node:fs'

// Surfaces the un-run remainder of a shard that bailed early via `maxFailures` as a CI
// WARNING. When the per-shard failure budget is reached, Playwright stops scheduling the
// remaining tests and ends the run with status `failed` (verified empirically — NOT
// `interrupted`, which Playwright reserves for Ctrl-C / the global timeout). Those un-run
// tests never execute, so they emit no Allure result and are silently ABSENT from the
// merged preview report (the `report` job in deploy-pages.yml) rather than shown red or
// skipped. A reviewer reading that partial report would have no signal that tests were
// dropped.
//
// This reporter detects the gap STRUCTURALLY rather than from the run status: a planned
// test that produced zero results is one the bail skipped (on a complete run — pass OR
// fail — every test records at least one result, and statically-skipped tests record a
// `skipped` result, so a normal run yields an empty set and the reporter stays silent).
// It emits a `::warning::` annotation plus a Step Summary block so the dropped tests are
// visible on the job.
//
// It is purely informational and changes nothing about the outcome: the tests that DID
// fail already exited non-zero and keep the e2e gate red. There is no per-test "warning"
// status in Playwright or Allure to set, so the honest representation of "the rest" is a
// job-level warning naming what did not run — not a yellow per-test result.
export default class BailWarningReporter implements Reporter {
  private rootSuite: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.rootSuite = suite
  }

  onEnd(): void {
    const planned = this.rootSuite?.allTests() ?? []
    const notRun = planned.filter((test) => test.results.length === 0)
    if (notRun.length === 0) return

    const shard = process.env.E2E_SHARD?.trim()
    const where = shard ? `shard ${shard}` : 'run'
    const message =
      `E2E ${where} stopped early after reaching the failure threshold (maxFailures): ` +
      `${notRun.length} of ${planned.length} test(s) did not run and are absent from the report. ` +
      `The tests that did fail still red the e2e gate; re-run to see the full failure picture.`

    // Always print a readable line (covers a local run with E2E_MAX_FAILURES set).
    console.warn(`\n⚠️  ${message}`)

    // GitHub-specific output (annotation + Step Summary) only under Actions, so local
    // runs don't emit raw workflow-command syntax.
    if (!process.env.GITHUB_ACTIONS) return
    console.log(`::warning title=E2E stopped early::${message}`)

    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!stepSummaryPath) return
    const SAMPLE = 10
    const listed = notRun
      .slice(0, SAMPLE)
      .map((test) => `- \`${test.titlePath().filter(Boolean).join(' › ')}\``)
    const more = notRun.length > SAMPLE ? `\n- …and ${notRun.length - SAMPLE} more` : ''
    const body =
      `### ⚠️ E2E ${where} stopped early\n\n` +
      `${message}\n\n` +
      `Tests not run (absent from the merged Allure report):\n\n` +
      `${listed.join('\n')}${more}\n\n`
    appendFileSync(stepSummaryPath, body)
  }
}
