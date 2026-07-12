import { urlHasOAuthCode } from '../oauth-callback-url'
import { captureTelemetryException } from './telemetry'

const WATCHDOG_DELAY_MS = 10_000

// Set by the callback controller (useGitHubOAuthCallbackController) the moment
// it mounts and starts handling the OAuth response — regardless of whether that
// handling ultimately succeeds or fails, both of which already have their own
// Sentry captures (issue #409, auth.ts's captureOAuthCallbackFailure). This flag
// exists purely to distinguish "a handler ran" from "no handler ran at all",
// which is the failure mode this watchdog exists to catch.
let handled = false

export const markOAuthCallbackHandled = (): void => {
  handled = true
}

/**
 * Backstop for the class of bug that motivated this watchdog: a shell can serve
 * GitHub's OAuth redirect at a URL with no '/auth/callback' route wired up at
 * all (the apps/host root composition before this fix), in which case NOTHING
 * throws, NOTHING calls completeGitHubOAuthCallback, and the user is silently
 * left logged out — zero errors, zero Sentry events. Arm this once per boot,
 * right after the app is ready: if the boot URL carried an OAuth `code` but
 * nothing marked itself as having handled it (and no token materialized) within
 * a generous window, something is wrong regardless of the reason, so report it.
 *
 * The `code` check happens ONCE, synchronously, at call time — not inside the
 * timeout — so a route change before the timeout fires can't make an
 * originally-code-bearing boot URL look unarmed (or vice versa).
 *
 * The 10s delay is deliberately generous: the real callback page is lazy-loaded
 * (a network round trip on a cold cache) and itself awaits a token exchange
 * over the network before marking itself handled. This watchdog only needs to
 * catch the "no handler exists" case, not race a normally-loading one — do not
 * shorten it.
 */
export const armOAuthCallbackWatchdog = (getToken: () => string | null): (() => void) => {
  if (!urlHasOAuthCode()) {
    return () => {}
  }

  const timeoutId = setTimeout(() => {
    if (handled || getToken() != null) {
      return
    }

    captureTelemetryException(
      new Error('GitHub OAuth callback returned but no handler consumed it'),
      {
        level: 'error',
        tags: { source: 'oauth', oauth_step: 'callback_unhandled' },
        contexts: { oauth: { step: 'callback_unhandled', reason: 'no_callback_handler_ran' } },
        // Distinct fingerprint from the auth.ts steps (issue #409) — this is a
        // different failure mode (no handler ran at all, vs. a handler running
        // and failing) and must not be conflated with those issues.
        fingerprint: ['oauth-callback', 'unhandled']
      }
    )
  }, WATCHDOG_DELAY_MS)

  return () => clearTimeout(timeoutId)
}
