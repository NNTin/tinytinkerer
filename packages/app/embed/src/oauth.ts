/**
 * `@nntin/tinytinkerer-embed/oauth` — finishing GitHub's sign-in redirect from
 * a host's EAGER code (issue #518, F3).
 *
 * Most of the package root is defined in the runtime's own chunk: one static
 * import of it can put the whole runtime in the host's startup bundle, and which
 * exports escape that is a build detail (issue #523, G2). A host that must
 * complete the callback before its own router runs imports this subpath
 * instead. It is side-effect free and imports nothing — no React, no
 * stores, no telemetry; `scripts/check-package.mjs` fails the build if its
 * chunk graph grows past a few kilobytes, and the acceptance host imports it
 * eagerly and measures its own startup chunk.
 *
 * `completeGitHubOAuth` here takes the app's configuration, not a `BrowserApp`:
 * it verifies the state, exchanges the code through the edge and saves the
 * token for the next `initializeBrowserApp` with the same `storageNamespace`.
 * The root export `completeGitHubOAuth(app, url)` is unchanged for hosts that
 * already have an app. See docs/extending/host-sign-in.md.
 */
export {
  completeGitHubOAuth,
  GITHUB_OAUTH_CALLBACK_PATH,
  isGitHubOAuthCallback
} from '@tinytinkerer/app-browser/oauth'
export type { GitHubOAuthCallbackConfig } from '@tinytinkerer/app-browser/oauth'
