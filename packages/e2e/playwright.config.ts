import { defineConfig, devices } from '@playwright/test'

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
const baseURL = `http://localhost:${webPort}/web/`
const widgetURL = `http://localhost:${widgetPort}/widget/`
const mobileURL = `http://localhost:${mobilePort}/mobile/`

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
  // In CI the suite also emits Allure results so the PR deploy-preview report can
  // merge them with the vitest results (issue #254). resultsDir is relative to this
  // package, i.e. packages/e2e/allure-results — the reusable e2e workflow uploads it
  // as an artifact. Locally the report is irrelevant, so keep the plain list reporter.
  reporter: process.env.CI
    ? [['github'], ['list'], ['allure-playwright', { resultsDir: 'allure-results' }]]
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
  // Serves the prebuilt dist of all THREE shells, each from its own `vite preview`
  // on its own port (its own origin). Every shell must be built first (the generate:*
  // steps, then `turbo run build` for @tinytinkerer/web, @tinytinkerer/widget,
  // @tinytinkerer/mobile); CI and the README do this before invoking the suite.
  // `vite preview` is fast since it only serves static files, so the 120s window is
  // generous headroom. reuseExistingServer is only enabled when the package wrapper
  // generated the local random ports; in CI, or when a caller pins ports, always
  // start fresh so stale output cannot be served silently.
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
    }
  ]
})
