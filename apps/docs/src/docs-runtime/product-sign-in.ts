/**
 * Sign-in for every documentation surface (issue #479), extracted unchanged from
 * `live-lab/client-runtime.tsx`'s `beginDocsLabSignIn`.
 *
 * Sends a signed-out visitor to the product's OWN GitHub login (issue #451:
 * "direct signed-out visitors to the existing app login flow"), not a docs-local
 * OAuth flow. Deliberately uses a THROWAWAY shell with the PRODUCT's default
 * storage namespace (no override), because startGitHubOAuth stores its
 * state/return-url in sessionStorage keyed by that namespace, and the product's
 * own callback route (owned by apps/host at the site root) completes the
 * exchange under that same default namespace — a docs-namespaced shell here
 * would leave the callback unable to find the state it validates against.
 *
 * On return, the docs app picks the new token up the way it picks up any
 * product token: as read-only `hostToken` input at bootstrap
 * (see `createDocsBrowserApp`), which is why the assistant's own conversations
 * survive a login without being moved anywhere.
 */
import {
  canStartGitHubOAuth,
  createBrowserShell,
  resolveBrowserShellBootstrapConfig,
  startGitHubOAuth
} from '@tinytinkerer/app-browser'
import type { DocsRuntimeConfig } from './runtime-config'

export const beginDocsProductSignIn = (runtimeConfig: DocsRuntimeConfig): boolean => {
  const config = resolveBrowserShellBootstrapConfig({
    baseUrl: runtimeConfig.productBaseUrl,
    origin: window.location.origin,
    edgeBaseUrl: runtimeConfig.edgeBaseUrl,
    authMode: 'oauth',
    ...(runtimeConfig.githubClientId ? { githubClientId: runtimeConfig.githubClientId } : {})
  })
  const shell = createBrowserShell(config)
  if (!canStartGitHubOAuth(shell)) {
    return false
  }
  startGitHubOAuth(shell)
  return true
}
