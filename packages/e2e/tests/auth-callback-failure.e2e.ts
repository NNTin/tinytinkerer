import { test, expect } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../fixtures/first-load'

// Real-browser coverage of the GitHub OAuth callback FAILURE UX (issue #409).
// Before this change a failed callback left the user on a terse, dead-end
// message and emitted no signal. The callback page now shows the error AND a
// "Back to sign in" affordance so the failure is neither silent nor a trap.
//
// No GitHub mock is needed: an OAuth-state mismatch is a purely client-side
// failure (the CSRF guard rejects a returned `state` that no stored value
// matches), so it deterministically drives the error path without any network
// round-trip. The shell uses a HashRouter, so the OAuth query params live in
// `window.location.search`, before the `#/auth/callback` route — exactly where
// the callback controller reads them.
const WEB_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}/web/`
const CALLBACK_URL = `${WEB_ORIGIN}?code=fakeoauthcode1234567890&state=does-not-match#/auth/callback`

test('OAuth callback failure shows an error state with a way back', async ({ page }) => {
  await page.goto(CALLBACK_URL)

  // The telemetry-consent dialog auto-opens over the shell and its overlay would
  // intercept the click below; decline it (telemetry no-ops in dev anyway).
  await dismissTelemetryDialog(page)

  // The state guard rejects the unmatched `state`, so the callback surfaces its
  // error instead of silently swallowing the failure.
  await expect(page.getByText('Authentication failed. Please try signing in again.')).toBeVisible()

  const backToSignIn = page.getByRole('button', { name: 'Back to sign in' })
  await expect(backToSignIn).toBeVisible()

  // The affordance is real: it returns to the app root rather than stranding the
  // user on the callback page.
  await backToSignIn.click()
  // HashRouter routes on the fragment, so returning to the app root lands on the
  // `#/` route (the original OAuth query string stays in `location.search`).
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('Authentication failed. Please try signing in again.')).toBeHidden()
})
