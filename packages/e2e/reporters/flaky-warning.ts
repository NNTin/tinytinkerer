import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter'
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Surfaces flaky tests (failed, then passed on retry) two ways: a CI job WARNING (this
// file's original purpose) and, below, a rewrite of the merged Allure report's own
// status for that test so it can't be mistaken for a clean pass.
//
// `retries: 1` (playwright.config.ts) exists precisely so a flake doesn't red the CI
// gate, and Playwright's own exit code stays 0 for one — so nothing else in the
// pipeline treats it as a failure. Allure DOES track the retry: allure-playwright
// writes each attempt as its own result under the same `historyId`, and `allure
// generate` correctly derives `retriesCount`/`retriesStatusChange` on the merged entry
// from that (verified empirically against the live report). But that surfaces only as
// a small grey "status changed after retry" mark — buried in the Suites/Behaviors/
// Packages trees, absent from the Overview page, and requiring a viewer to already
// know the Marks filter exists. The headline status column still reads "Passed".
//
// markFlakyTestsBroken() below closes that gap by rewriting the FINAL (passing)
// attempt's own raw result file from "passed" to "broken" once Playwright has decided
// the outcome — a deliberate, explained departure from that attempt's literal outcome,
// in exchange for a report where a recovered flake cannot read as a clean run. CI's
// exit code is unaffected: it was already decided before this reporter runs.
export default class FlakyWarningReporter implements Reporter {
  private rootSuite: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.rootSuite = suite
  }

  onEnd(): void {
    const planned = this.rootSuite?.allTests() ?? []
    const flaky = planned.filter((test) => test.outcome() === 'flaky')
    if (flaky.length === 0) return

    markFlakyTestsBroken(flaky)

    const shard = process.env.E2E_SHARD?.trim()
    const where = shard ? `shard ${shard}` : 'run'
    const message =
      `E2E ${where} had ${flaky.length} flaky test(s) — failed at least once, then passed ` +
      `on retry. They are marked "broken" (not "passed") in the merged Allure report so ` +
      `they don't read as a clean run; CI itself stayed green (that's what \`retries: 1\` ` +
      `is for). A test flaking repeatedly is worth investigating regardless.`

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

type AllureResultLike = {
  name?: string
  status?: string
  statusDetails?: { message?: string; trace?: string }
  labels?: { name: string; value: string }[]
}

// Matches a Playwright TestCase to its raw allure-playwright result file(s) by (test
// title, full parent titlePath) — the same pair allure-playwright itself writes as the
// `name` field and the `titlePath` label (see its onTestBegin), so this needs no
// knowledge of allure's internal historyId hashing to stay in sync with it.
export const matchesTest = (result: AllureResultLike, test: TestCase, titlePath: string): boolean =>
  result.name === test.title &&
  (result.labels ?? []).some((label) => label.name === 'titlePath' && label.value === titlePath)

const readResult = (path: string): AllureResultLike =>
  JSON.parse(readFileSync(path, 'utf8')) as AllureResultLike

/**
 * Rewrites the passing, final-attempt Allure result of each flaky test to "broken",
 * with a `statusDetails.message` explaining the override. allure-playwright (also in
 * the CI-only reporter list) has already written every attempt's result file by the
 * time any reporter's `onEnd` runs — Playwright calls `onTestEnd` on every reporter for
 * every attempt before calling `onEnd` on any of them — so the file this function wants
 * is guaranteed to already be on disk, regardless of reporter registration order.
 */
export function markFlakyTestsBroken(flaky: TestCase[]): void {
  const resultsDir = join(process.cwd(), 'allure-results')
  let files: string[]
  try {
    files = readdirSync(resultsDir).filter((name) => name.endsWith('-result.json'))
  } catch {
    return
  }

  for (const test of flaky) {
    const titlePath = test.parent.titlePath().join(' > ')
    const finalAttemptPath = files.find((name) => {
      const path = join(resultsDir, name)
      let result: AllureResultLike
      try {
        result = readResult(path)
      } catch {
        return false
      }
      return result.status === 'passed' && matchesTest(result, test, titlePath)
    })
    if (!finalAttemptPath) continue

    const path = join(resultsDir, finalAttemptPath)
    const result = readResult(path)
    result.status = 'broken'
    result.statusDetails = {
      message:
        'Marked broken: this test failed on its first attempt and only passed after ' +
        "Playwright's automatic retry. CI treated the retry as a pass (exit code 0) — " +
        'this status is deliberately overridden so a recovered flake does not read as ' +
        'a clean run here. See the Retries tab for the original failure.'
    }
    writeFileSync(path, JSON.stringify(result))
  }
}
