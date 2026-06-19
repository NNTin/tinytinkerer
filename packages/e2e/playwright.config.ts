import { defineConfig, devices } from '@playwright/test'

// Per-run port. The package's `e2e` script sets E2E_PORT once before invoking
// Playwright, and CI pins it explicitly. Do not generate a fallback here: this
// config is evaluated by more than one Playwright process, so an in-config random
// value can make the web server and test workers disagree on baseURL.
const rawPort = process.env.E2E_PORT
if (!rawPort) {
  throw new Error('E2E_PORT must be set. Run through `pnpm --filter @tinytinkerer/e2e e2e`.')
}
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`E2E_PORT must be a valid TCP port, got ${rawPort}`)
}
// The web shell is built with Vite base '/web/', so `vite preview` serves the app
// under /web/. Tests navigate to baseURL ('…/web/'); the app's edge calls use
// absolute paths (/api/...) which the in-page mock intercepts regardless of base.
const origin = `http://localhost:${port}`
const baseURL = `${origin}/web/`

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
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    // Phase 1: Chromium only (matches the primary deployment target, smallest
    // WSL2/CI install). Firefox + WebKit are a tracked follow-up — the isolation
    // guarantees are engine-sensitive, so cross-engine coverage is desirable but
    // deferred to keep the first landing small. Tracked by issue #245.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  // Serves the prebuilt apps/web/dist. The web app must be built first
  // (`pnpm --filter @tinytinkerer/web build`, after the generate:* steps); CI and
  // the README do this before invoking the suite. `vite preview` is fast since it
  // only serves static files, so the 120s window is generous headroom.
  webServer: {
    command: `pnpm --filter @tinytinkerer/web exec vite preview --port ${port} --strictPort`,
    url: baseURL,
    // Reuse a running server only when the package wrapper generated the local
    // random port. In CI, or when a caller pins E2E_PORT, always start fresh so
    // stale output cannot be served silently.
    reuseExistingServer: !process.env.CI && process.env.E2E_PORT_GENERATED === '1',
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
