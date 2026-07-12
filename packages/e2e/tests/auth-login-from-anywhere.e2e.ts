import { test, expect, type Page } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../fixtures/first-load'

// Login must work — and RETURN YOU TO WHERE YOU STARTED — from every surface
// (/, /web, /widget, /mobile), not just the root. The GitHub redirect_uri every
// surface registers resolves to the origin ROOT (apps/host owns it; the shells
// share one relative-based build so they cannot form a per-path redirect_uri —
// see packages/app/app-browser/src/config.ts), so GitHub sends EVERY login back
// to `/#/auth/callback`. Without the stored return URL the callback would strand
// the user on `/` regardless of where they clicked "Sign in"; `startGitHubOAuth`
// now records the starting document so the callback can send them back.
//
// A real GitHub round-trip isn't possible here, so this drives the callback leg
// directly: it seeds the exact sessionStorage `startGitHubOAuth` writes (the CSRF
// state + the return URL for the surface under test), mocks the edge token
// exchange, then loads the root callback GitHub would have redirected to. The
// assertion — that the browser lands back on the surface's own path — is the
// whole point of the fix, and it fails on the pre-fix `navigate('/')` behavior
// for every non-root surface.
//
// The matrix is the reusable part: add a surface here and it is covered.
const ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`

// storageNamespace defaults to 'tinytinkerer' on every surface (host + shells),
// so the state/return-url keys are shared across the root callback and the
// surface the user started on.
const STORAGE_NS = 'tinytinkerer'
const OAUTH_STATE = 'e2e-oauth-state-1234567890'
const OAUTH_CODE = 'e2e-oauth-code-1234567890'
const ACCESS_TOKEN = 'e2e-oauth-access-token'

const SURFACES = [
  { name: 'root', path: '/' },
  { name: 'web', path: '/web/' },
  { name: 'widget', path: '/widget/' },
  { name: 'mobile', path: '/mobile/' }
] as const

// Stand in for GitHub's token endpoint (proxied by the edge): the browser's
// exchange POST is answered with a token so the callback reaches its success
// branch and restores the return URL. A real edge/GitHub is never involved.
const mockTokenExchange = async (page: Page): Promise<void> => {
  await page.route('**/auth/github/exchange', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: ACCESS_TOKEN })
    })
  )
}

for (const surface of SURFACES) {
  test(`login started on ${surface.name} returns to ${surface.name} after the callback`, async ({
    page
  }) => {
    const surfaceUrl = `${ORIGIN}${surface.path}#/`

    await mockTokenExchange(page)

    // Land on the surface the user "started" from (same origin as the callback),
    // then seed exactly what startGitHubOAuth persists before redirecting to
    // GitHub: the CSRF state and the return URL for this surface.
    await page.goto(surfaceUrl)
    await dismissTelemetryDialog(page)
    await page.evaluate(
      ({ ns, state, returnUrl }) => {
        sessionStorage.setItem(`${ns}:oauth_state`, state)
        sessionStorage.setItem(`${ns}:oauth_return_url`, returnUrl)
      },
      { ns: STORAGE_NS, state: OAUTH_STATE, returnUrl: surfaceUrl }
    )

    // GitHub redirects every login to the origin root regardless of surface.
    await page.goto(`${ORIGIN}/#/auth/callback?code=${OAUTH_CODE}&state=${OAUTH_STATE}`)

    // The callback exchanges the code, persists the token, and returns the user
    // to the surface they started on — NOT the root. Success is signalled by the
    // callback route dropping off the URL (poll on that so we wait for the async
    // exchange even when the pathname never changes, i.e. the root case); then
    // confirm the landing path is the surface's own, not `/` (the pre-fix bug).
    await expect.poll(() => page.url()).not.toContain('auth/callback')
    expect(new URL(page.url()).pathname).toBe(surface.path)
  })
}
