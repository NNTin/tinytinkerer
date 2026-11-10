// The embedding-host callback (issue #510 T5), kept out of auth.ts so it never
// lands in a shell's chat route chunk: only a host that imports it pays for it.
import type { BrowserApp } from './app'
import { completeGitHubOAuthCallback, consumeGitHubOAuthReturnUrl } from './auth'
import { readOAuthCallbackParamsFrom } from './oauth-callback-url'
import { markOAuthCallbackHandled } from './telemetry/oauth-callback-handled'

// Only a same-origin return URL can be restored with `history.replaceState`
// (which throws on a cross-origin URL), and only one is safe to hand a host to
// navigate to. Anything else — a malformed value, or an embedded flow that
// started on another origin's top-level page — is dropped.
const toSameOriginReturnUrl = (returnUrl: string | null): string | null => {
  if (!returnUrl) return null
  try {
    return new URL(returnUrl, window.location.href).origin === window.location.origin
      ? returnUrl
      : null
  } catch {
    return null
  }
}

/**
 * Finish a GitHub sign-in on an embedding host's own callback page (issue #510
 * T5). Call it on load when `location.pathname === GITHUB_OAUTH_CALLBACK_PATH`.
 *
 * Reads `code` and `state` from `url` (default: the current location; both the
 * plain-query and hash-routed callback shapes are understood), checks `state`
 * against the one `startGitHubOAuth` stored under the app's
 * `storageNamespace`, exchanges the code through the edge, and signs `app` in
 * (persisting the token like any other sign-in). Resolves to the URL the reader
 * started from — same-origin only — or `null` when none was saved; the host
 * restores it with `history.replaceState(null, '', returnUrl)`, which also
 * removes `code`/`state` from the address bar. With `null`, the host should
 * still replace the callback URL with a landing page of its choice.
 *
 * Rejects with a user-presentable `Error` when the code is missing, the state
 * does not match (the CSRF check), or the exchange fails. Each failure is
 * reported to telemetry like the shells' own callback; the authorization code
 * itself is never reported.
 *
 * The app does not need to be mounted: the token is persisted to the app's
 * token storage and picked up by `initializeBrowserApp`. A host that mounts the
 * app first should await this before rendering `ChatApp`.
 */
export const completeGitHubOAuth = async (
  app: BrowserApp,
  url: string | URL = window.location.href
): Promise<string | null> => {
  // Defuses the boot-time "no handler ran" watchdog, exactly as the shells'
  // callback controller does when it mounts.
  markOAuthCallbackHandled()
  await completeGitHubOAuthCallback(app, readOAuthCallbackParamsFrom(new URL(url)))
  return toSameOriginReturnUrl(consumeGitHubOAuthReturnUrl(app.shell))
}
