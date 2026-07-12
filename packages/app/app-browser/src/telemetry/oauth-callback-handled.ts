// Set by the callback controller (useGitHubOAuthCallbackController) the moment
// it mounts and starts handling the OAuth response — regardless of whether that
// handling ultimately succeeds or fails, both of which already have their own
// Sentry captures (issue #409, auth.ts's captureOAuthCallbackFailure). This flag
// exists purely to distinguish "a handler ran" from "no handler ran at all",
// which is the failure mode the OAuth callback watchdog exists to catch.
//
// Kept in its own tiny module — separate from ./oauth-callback-watchdog — so the
// eager callback path (surfaces.tsx) can flip the flag without statically pulling
// the 10s backstop (and its setTimeout/telemetry wiring) into the startup entry
// chunk. The watchdog reads this flag; it stays behind browser-app-shell's dynamic
// import.
let handled = false

export const markOAuthCallbackHandled = (): void => {
  handled = true
}

export const wasOAuthCallbackHandled = (): boolean => handled
