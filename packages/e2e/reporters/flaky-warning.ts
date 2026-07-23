import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter'
import { appendFileSync } from 'node:fs'

// Surfaces flaky tests (failed, then passed on retry) as a CI WARNING. Playwright's own
// exit code stays 0 for a flaky test — `retries: 1` (playwright.config.ts) exists
// precisely so a flake doesn't red the gate — so nothing else in the pipeline treats it
// as a failure. The merged Allure report (the `report` job in deploy-pages.yml) shows the
// test's FINAL status only: allure-playwright records each attempt as a separate result
// under the same `historyId`, and `allure generate` correctly links them (the test's
// `retriesCount`/`retriesStatusChange` fields are set), but Allure's own `flaky` boolean
// is a distinct concept — set only when a test is explicitly annotated as known-flaky by
// the framework, never auto-derived from a within-run retry recovering. So the report
// renders fully green with no visible signal, and a reviewer skimming it would never know
// a test needed a retry. This reporter is the honest signal: a job-level warning naming
// what flaked, alongside (not instead of) the still-green report.
//
// Detection uses Playwright's own `TestCase.outcome()`, which returns `'flaky'` exactly
// for "failed at least once, then passed" — no need to re-derive that from `test.results`.
export default class FlakyWarningReporter implements Reporter {
  private rootSuite: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.rootSuite = suite
  }

  onEnd(): void {
    const planned = this.rootSuite?.allTests() ?? []
    const flaky = planned.filter((test) => test.outcome() === 'flaky')
    if (flaky.length === 0) return

    const shard = process.env.E2E_SHARD?.trim()
    const where = shard ? `shard ${shard}` : 'run'
    const message =
      `E2E ${where} had ${flaky.length} flaky test(s) — failed at least once, then passed ` +
      `on retry. The merged Allure report shows these as plain green (its "flaky" flag is ` +
      `never auto-set from retries), so this warning is the only surviving signal; a test ` +
      `flaking repeatedly is worth investigating even though it did not red the gate.`

    // Always print a readable line (covers a local run with retries enabled).
    console.warn(`\n⚠️  ${message}`)

    // GitHub-specific output (annotation + Step Summary) only under Actions, so local
    // runs don't emit raw workflow-command syntax.
    if (!process.env.GITHUB_ACTIONS) return
    console.log(`::warning title=E2E flaky tests::${message}`)

    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!stepSummaryPath) return
    const SAMPLE = 10
    const listed = flaky
      .slice(0, SAMPLE)
      .map((test) => `- \`${test.titlePath().filter(Boolean).join(' › ')}\``)
    const more = flaky.length > SAMPLE ? `\n- …and ${flaky.length - SAMPLE} more` : ''
    const body =
      `### ⚠️ E2E ${where} had flaky tests\n\n` +
      `${message}\n\n` +
      `Flaky tests (passed on retry):\n\n` +
      `${listed.join('\n')}${more}\n\n`
    appendFileSync(stepSummaryPath, body)
  }
}
