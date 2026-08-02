import { defineConfig, devices } from '@playwright/test'
import { installNoLiveQuotaGuard } from './fixtures/no-live-quota'

// Fail closed on live model/edge/API traffic (issue #481), before anything else
// in this process can send any. `/api/**` is piped through the REAL edge worker
// in-process, so Node's `fetch` is the one path out of the machine — and until
// this guard existed, a spec that forgot to install a mock would have reached
// whatever upstream the environment pointed at and spent real quota, silently.
//
// Called here rather than from a `globalSetup`, which Playwright runs in its own
// process: this config is re-evaluated in EVERY Playwright process (the same fact
// the shard tagging below depends on), so this is the one place a module-scope
// patch is guaranteed to land in the process that actually serves the edge.
installNoLiveQuotaGuard()

// Structural shape of the Allure result/label objects the `beforeTestResultStop`
// listener mutates. allure-playwright's reporter options are typed as `any` by
// Playwright's `ReporterDescription` ([string, any]) and the precise types live in
// the transitive `allure-js-commons` package (not a direct dependency), so we model
// just the `labels` we read and append rather than import internal types.
type AllureLabel = { name: string; value: string }
type AllureTestResult = { labels: AllureLabel[] }

// Per-run port. The package's `e2e` script sets E2E_PORT for the shared deployed
// origin before invoking Playwright, and CI pins it explicitly. Static-analysis tools
// also load this config without running the wrapper, so use one deterministic fallback
// rather than throwing or generating a value that could differ between processes.
const resolvePort = (name: string, fallback: number): number => {
  const raw = process.env[name] ?? String(fallback)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port, got ${raw}`)
  }
  return port
}

// Every browser endpoint is served from the composed apps/host/dist origin, matching
// production. IndexedDB and authentication state are therefore shared across mount
// paths while each app retains its own database namespace where needed.
const webPort = resolvePort('E2E_PORT', 43_117)

// Bail-fast budget. A single root cause typically reds many tests at once, and with
// `retries: 1` each failure runs twice — so a fully-reddened shard burns CI minutes
// (worst of all when the cascade manifests as 60s timeouts). `maxFailures` stops a shard
// once N tests have failed; the remaining tests are then not run and the reporter below
// (`reporters/bail-warning.ts`) surfaces them as a job WARNING.
//
// This is PER Playwright process, i.e. PER SHARD — the suite is sharded into independent
// jobs (e2e-reusable.yml) with no cross-shard coordination, so the effective budget is
// N×(shard count). That is acceptable: `--shard` distributes a cascade's victims across
// shards, so each affected shard bails on its own cluster.
//
// CI-only by default (3); unbounded locally so a developer's full run is never truncated.
// Override with E2E_MAX_FAILURES (0 = unbounded). Verified: a flaky test that passes on
// retry does NOT count toward the budget, so `retries: 1` absorbs flakes without tripping
// the bail; only tests that finally fail count, each after exhausting its retries.
const resolveMaxFailures = (): number => {
  const raw = process.env.E2E_MAX_FAILURES
  if (raw !== undefined && raw.trim() !== '') {
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`E2E_MAX_FAILURES must be a non-negative integer, got ${raw}`)
    }
    return value
  }
  return process.env.CI ? 3 : 0
}

// Same origin (webPort), different path — one shell build serves all three.
const baseURL = `http://localhost:${webPort}/web/`

/**
 * The specs that run on all three engines, not just Chromium.
 *
 * Kept as a named list rather than a glob so adding one is a visible decision:
 * every entry here triples its own runtime, and the reason it earns that is
 * recorded beside the projects below.
 */
const CROSS_ENGINE_SPECS = ['**/sandbox-isolation.e2e.ts', '**/docs/assistant-cross-engine.e2e.ts']

// The app under test is the standalone web shell built for production (so the
// minified SANDBOX_SRCDOC + worker bootstrap are exercised, not just the dev
// bundle). `vite preview` serves apps/web/dist; the e2e:build script produces it.
// LiteLLM is never reached: every /api/models/chat call is intercepted in-page
// and answered from a fixture (see fixtures/mock-litellm.ts), so the suite needs
// no edge, no auth, and no network — anonymous mode and disabled rate limiting
// are intrinsic to that design.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  // The plugin requests an 8s sandbox deadline (the host caps at 10s); the teardown
  // spec waits it out, so give each test headroom above that.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Stop a shard early once this many tests have failed (see resolveMaxFailures above).
  maxFailures: resolveMaxFailures(),
  // In CI the suite also emits Allure results so the PR deploy-preview report can
  // merge them with the vitest results (issue #254). resultsDir is relative to this
  // package, i.e. packages/e2e/allure-results — the reusable e2e workflow uploads it
  // as an artifact. Locally the report is irrelevant, so keep the plain list reporter.
  //
  // The `beforeTestResultStop` listener promotes two facts to search-bar tags so the
  // MERGED report (which combines every shard's results by test, erasing the shard
  // boundary) stays filterable (issue #258):
  //   - browser — allure-playwright already records it as the `parentSuite` label
  //     (the project name: chromium/firefox/webkit), so we mirror it to a `tag`;
  //   - shard — not otherwise captured, since the merge folds all shards together.
  //     The e2e workflow sets E2E_SHARD per matrix job; we read it here (the config
  //     is re-evaluated in every Playwright process, so it sees that process's env)
  //     and emit a `shard-<n>` tag. Folding the shard into executor.json instead was
  //     rejected: executor.json is per-RUN, so it could not distinguish shards within
  //     the one merged report — a per-test tag can.
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        // Emits a job WARNING listing the tests a `maxFailures` bail skipped — they
        // otherwise vanish silently from the merged Allure report (they run no test, so
        // produce no result). See reporters/bail-warning.ts.
        ['./reporters/bail-warning.ts'],
        // Emits a job WARNING listing tests that failed then passed on retry — the
        // merged Allure report shows only their final (green) status. See
        // reporters/flaky-warning.ts.
        ['./reporters/flaky-warning.ts'],
        [
          'allure-playwright',
          {
            resultsDir: 'allure-results',
            listeners: [
              {
                beforeTestResultStop: (result: AllureTestResult) => {
                  const tags = new Set(
                    result.labels
                      .filter((label) => label.name === 'tag')
                      .map((label) => label.value)
                  )
                  const addTag = (value: string | undefined) => {
                    if (value && !tags.has(value)) {
                      tags.add(value)
                      result.labels.push({ name: 'tag', value })
                    }
                  }
                  addTag(result.labels.find((label) => label.name === 'parentSuite')?.value)
                  const shard = process.env.E2E_SHARD?.trim()
                  if (shard) {
                    addTag(`shard-${shard}`)
                  }
                }
              }
            ]
          }
        ]
      ]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    // Chromium runs the whole suite (the primary deployment target). Two specs
    // ALSO run on Gecko + WebKit, and each names why below; everything else
    // stays Chromium-only, so a cross-engine run costs three specs rather than
    // three suites.
    //
    // - sandbox-isolation (issue #245): CSP-in-srcdoc, opaque-origin iframes,
    //   blob: Worker creation, how a CSP-blocked WebSocket/EventSource fails,
    //   indexedDB at an opaque origin, Worker-scope API absence.
    // - assistant-cross-engine (issue #482): the documentation assistant's
    //   overlay contract leans on `inert`, `isolation: isolate`, and CSS custom
    //   properties on `<html>` — the parts of #480 an engine could plausibly
    //   differ on. The exhaustive accessibility, contrast, performance and
    //   regression specs stay on Chromium.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testMatch: CROSS_ENGINE_SPECS,
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testMatch: CROSS_ENGINE_SPECS,
      use: { ...devices['Desktop Safari'] }
    }
  ],
  // Serve the composed production surface from one origin. The host dist includes
  // /web/, /widget/, /mobile/, /canvas/, /ide/, /mermaid/, and /pixel-agents/.
  webServer: {
    command: `pnpm --filter @tinytinkerer/host exec vite preview --outDir dist --port ${webPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
