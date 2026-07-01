import { defineConfig, devices } from '@playwright/test'

// Structural shape of the Allure result/label objects the `beforeTestResultStop`
// listener mutates. allure-playwright's reporter options are typed as `any` by
// Playwright's `ReporterDescription` ([string, any]) and the precise types live in
// the transitive `allure-js-commons` package (not a direct dependency), so we model
// just the `labels` we read and append rather than import internal types.
type AllureLabel = { name: string; value: string }
type AllureTestResult = { labels: AllureLabel[] }

// Per-run ports — one per product shell. The package's `e2e` script sets all three
// (E2E_PORT / E2E_PORT_WIDGET / E2E_PORT_MOBILE) once before invoking Playwright, and
// CI pins them explicitly. Do not generate a fallback here: this config is evaluated
// by more than one Playwright process, so an in-config random value can make the web
// servers and test workers disagree on their base URLs.
const requirePort = (name: string): number => {
  const raw = process.env[name]
  if (!raw) {
    throw new Error(`${name} must be set. Run through \`pnpm --filter @tinytinkerer/e2e e2e\`.`)
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port, got ${raw}`)
  }
  return port
}

// Each shell is built with its own Vite base ('/web/', '/widget/', '/mobile/') and
// served by `vite preview` on its own port — i.e. its own ORIGIN. Tests navigate to
// the per-shell base URL; the app's edge calls use absolute paths (/api/...) which
// the in-page mock intercepts regardless of origin or base. Because IndexedDB is
// origin-scoped, the three shells' storage is ISOLATED despite sharing the default
// `tinytinkerer` DB name (see tests/chat-persistence.e2e.ts).
const webPort = requirePort('E2E_PORT')
const widgetPort = requirePort('E2E_PORT_WIDGET')
const mobilePort = requirePort('E2E_PORT_MOBILE')
const canvasPort = requirePort('E2E_PORT_CANVAS')

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

const baseURL = `http://localhost:${webPort}/web/`
const widgetURL = `http://localhost:${widgetPort}/widget/`
const mobileURL = `http://localhost:${mobilePort}/mobile/`
const canvasURL = `http://localhost:${canvasPort}/canvas/`

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
    // Chromium runs the whole suite (the primary deployment target). The
    // sandbox-isolation guarantees are engine-sensitive (CSP-in-srcdoc,
    // opaque-origin iframes, blob: Worker creation, how a CSP-blocked
    // WebSocket/EventSource fails, indexedDB at an opaque origin, Worker-scope
    // API absence), so they ALSO run on Gecko + WebKit (issue #245). The other
    // specs stay Chromium-only — out of scope for #245 — by restricting the
    // firefox/webkit projects to just the sandbox-isolation spec via testMatch.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testMatch: '**/sandbox-isolation.e2e.ts',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testMatch: '**/sandbox-isolation.e2e.ts',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  // Serves the prebuilt dist of all FOUR shells, each from its own `vite preview`
  // on its own port (its own origin). Every shell must be built first (the generate:*
  // steps, then `turbo run build` for @tinytinkerer/web, @tinytinkerer/widget,
  // @tinytinkerer/mobile, @tinytinkerer/canvas); CI and the README do this before
  // invoking the suite. `vite preview` is fast since it only serves static files, so
  // the 120s window is generous headroom. reuseExistingServer is only enabled when the
  // package wrapper generated the local random ports; in CI, or when a caller pins
  // ports, always start fresh so stale output cannot be served silently.
  webServer: [
    {
      command: `pnpm --filter @tinytinkerer/web exec vite preview --port ${webPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: `pnpm --filter @tinytinkerer/widget exec vite preview --port ${widgetPort} --strictPort`,
      url: widgetURL,
      reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: `pnpm --filter @tinytinkerer/mobile exec vite preview --port ${mobilePort} --strictPort`,
      url: mobileURL,
      reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      // The canvas shell hosts the sandboxed Excalidraw iframe. Its `vite preview` sends
      // Access-Control-Allow-Origin (apps/canvas/vite.config.ts preview.headers) so the
      // opaque-origin iframe can load its ES-module assets, matching production.
      command: `pnpm --filter @tinytinkerer/canvas exec vite preview --port ${canvasPort} --strictPort`,
      url: canvasURL,
      reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
})
