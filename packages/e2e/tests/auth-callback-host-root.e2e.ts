import { test, expect } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../fixtures/first-load'

// Regression coverage for the issue #409 FOLLOW-UP: the dev root
// (https://dev.tiny.nntin.xyz/) serves apps/host, whose RootComposition had NO
// '/auth/callback' route at all. GitHub's redirect back to '…/#/auth/callback'
// just re-rendered the three-pane composition — completeGitHubOAuthCallback
// never ran, so login silently failed with zero errors and zero Sentry events.
// The host now wires the same lazy '/auth/callback' route the other shells use.
//
// As with auth-callback-failure.e2e.ts, no GitHub mock is needed: an OAuth-state
// mismatch is a purely client-side failure (the CSRF guard rejects a returned
// `state` that no stored value matches), so it deterministically drives the
// error path — and, crucially, reaching that error at all PROVES the root now
// runs the callback controller instead of rendering the composition.
const ROOT_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}/`

// The callback code/state land in the HASH FRAGMENT'S query part, not
// window.location.search — the redirect_uri every shell registers is
// '…/#/auth/callback', so GitHub can append '?code=…&state=…' after the '#'.
// This asserts the shared controller reads params from the fragment too
// (oauth-callback-url.ts); before that fix the root would have reported the
// wrong error ("No authorization code received") even with the route present.
const CALLBACK_URL = `${ROOT_ORIGIN}#/auth/callback?code=fakeoauthcode1234567890&state=does-not-match`

test('host root completes (and fails visibly on) the GitHub OAuth callback', async ({ page }) => {
  await page.goto(CALLBACK_URL)

  // The telemetry-consent dialog auto-opens over the shell and its overlay would
  // intercept the click below; decline it (telemetry no-ops in dev anyway).
  await dismissTelemetryDialog(page)

  // The controller ran (route exists) AND read the fragment params (so it got to
  // the state guard rather than reporting a missing code); the unmatched `state`
  // then surfaces the actionable error instead of a silent logged-out root.
  await expect(page.getByText('Authentication failed. Please try signing in again.')).toBeVisible()

  const backToSignIn = page.getByRole('button', { name: 'Back to sign in' })
  await expect(backToSignIn).toBeVisible()

  // The affordance returns to the app root (the composition) rather than
  // stranding the user on the callback page.
  await backToSignIn.click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByText('Authentication failed. Please try signing in again.')).toBeHidden()
})
