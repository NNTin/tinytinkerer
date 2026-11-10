---
title: GitHub Sign-In for Embedding Hosts
sidebar_position: 8
---

<!--
This document reflects the current host sign-in implementation (issue #510 T5):
packages/app/app-browser/src/auth.ts, apps/edge/src/routes/auth.ts, and
apps/edge/src/lib/require-auth-origins.ts. Update it when that contract changes.
-->

# GitHub Sign-In for Embedding Hosts

A page on another origin that embeds the tinytinkerer chat runtime (for example CanFactory on
`https://canfactory.nntin.xyz`) can run GitHub sign-in itself and require it before the assistant
answers. It uses tinytinkerer's existing GitHub OAuth App and edge. The host needs no OAuth App, no
relay and no secret of its own.

## How the pieces fit

- **One OAuth App.** tinytinkerer's OAuth App registers its callback at the parent domain,
  `https://nntin.xyz/`. GitHub accepts a `redirect_uri` on any subdomain of the registered host,
  under the registered path. So `https://canfactory.nntin.xyz/auth/github/callback` is valid for
  that app as it is, the same way `dev.tiny` and every `pr-*.tiny.preview` origin sign in. Prod and
  develop share the app, so one client id (the frontend's `VITE_GITHUB_CLIENT_ID`) serves every
  origin.
- **The edge checks the callback.** `POST /auth/github/exchange` requires `redirectUri`. Its origin
  must equal the request's `Origin`, and that origin must pass the edge's CORS allowlist
  (`ALLOWED_ORIGINS`, the same matcher). Otherwise the edge answers `400 Invalid OAuth redirect
URI` and never calls GitHub. A host can therefore only complete sign-in for a callback on its own
  page, and only on an edge that already serves it.
- **Sign-in can be required per origin.** An origin in the edge's `REQUIRE_AUTH_ORIGINS` gets
  `401` on the models, search and MCP routes unless it sends a valid GitHub token. It never falls
  back to the shared anonymous LiteLLM key, and no key is minted for it. See
  [Self-hosting: required sign-in per origin](../self-hosting/vercel-deployment.md#required-sign-in-per-origin).

## Host configuration

```ts
import {
  completeGitHubOAuth,
  createBrowserApp,
  GITHUB_OAUTH_CALLBACK_PATH
} from '@tinytinkerer/app-browser'

const app = createBrowserApp(
  {
    edgeBaseUrl: 'https://api.tiny.nntin.xyz',
    storageNamespace: 'canfactory',
    authMode: 'oauth',
    githubClientId: '<tinytinkerer OAuth App client id>',
    githubRedirectUri: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`
  },
  { plugins: () => Promise.resolve([]) }
)
```

- `authMode: 'oauth'` means **sign-in required**. While signed out, `ChatApp` shows a "Sign in with
  GitHub" call to action instead of the chat, and sends nothing to the edge. That includes status
  polling, the model catalogue, MCP discovery and runs. The default `'hybrid'` keeps the anonymous
  composer.
- `githubRedirectUri` must be set: `canStartGitHubOAuth` is `false` without it, because the edge
  could never accept the exchange. Use the non-hash path `/auth/github/callback`
  (`GITHUB_OAUTH_CALLBACK_PATH`). It sits outside `/api/` and needs no client-side router.
- `storageNamespace` scopes the OAuth `state` and the return URL in `sessionStorage`, so the
  callback must be completed by an app with the **same** namespace.

## Completing the callback

```ts
completeGitHubOAuth(app: BrowserApp, url?: string | URL): Promise<string | null>
```

On load, before mounting the chat, the host checks for its callback path:

```ts
if (window.location.pathname === GITHUB_OAUTH_CALLBACK_PATH) {
  try {
    const returnUrl = await completeGitHubOAuth(app)
    window.history.replaceState(null, '', returnUrl ?? '/')
  } catch (error) {
    // A user-presentable message: missing code, state mismatch, or a failed exchange.
    showSignInError(error instanceof Error ? error.message : 'Sign-in failed.')
    window.history.replaceState(null, '', '/')
  }
}
```

`completeGitHubOAuth` does the following:

1. Reads `code` and `state` from `url`, which defaults to the current location. It understands
   both a plain query string and the shells' hash-routed `#/auth/callback?…`.
2. Checks `state` against the value `startGitHubOAuth` stored under the app's `storageNamespace`
   (the CSRF check). It rejects if `state` doesn't match or there is no `code`, before any network
   call.
3. Exchanges the code through the edge's `/auth/github/exchange`, sending the configured
   `githubRedirectUri`.
4. Signs the app in by persisting the token to the app's token storage, which
   `initializeBrowserApp` picks up.
5. Resolves to the URL the reader started from, or `null` if none was saved. Only same-origin URLs
   are returned, so the value is always safe to pass to `history.replaceState`, which also removes
   `code` and `state` from the address bar.

Failures are reported to telemetry like the shells' own callback. The authorization code is never
reported.

## Limits

- **No localhost sign-in in v1.** The `https://nntin.xyz/` callback does not cover
  `http://localhost:5173`. Test sign-in on a preview origin such as
  `https://canfactory-preview.nntin.xyz`. The develop edge still allows `localhost:5173` for CORS,
  and requires sign-in there.
- **Shared budgets.** A host's signed-in readers get the same per-GitHub-user LiteLLM key as on
  tinytinkerer itself. Budget and rate limits are shared across every site that uses the same edge.
