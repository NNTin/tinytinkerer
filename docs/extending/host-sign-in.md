---
title: GitHub Sign-In for Embedding Hosts
sidebar_position: 8
---

<!--
This document reflects the current host sign-in implementation (issue #510 T5, #518 F3/F4/F9):
packages/app/app-browser/src/auth.ts, packages/app/app-browser/src/oauth.ts (the
`@nntin/tinytinkerer-embed/oauth` subpath), apps/edge/src/routes/auth.ts, and
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
- **That is a browser-origin policy, not access control.** The edge decides by the request's
  `Origin` header. Your page never uses the anonymous path, because a browser always sends your
  origin. A non-browser client that sends no `Origin`, or another one, still gets the anonymous
  path, so `REQUIRE_AUTH_ORIGINS` does not protect the edge or its budget from anyone.

## Host configuration

```ts
import {
  createBrowserApp,
  GITHUB_OAUTH_CALLBACK_PATH,
  resolveBrowserShellBootstrapConfig
} from '@nntin/tinytinkerer-embed'

const config = resolveBrowserShellBootstrapConfig({
  baseUrl: '/',
  origin: window.location.origin,
  edgeBaseUrl: 'https://api.tiny.nntin.xyz',
  storageNamespace: 'canfactory',
  authMode: 'oauth',
  githubClientId: runtime.githubClientId, // may be undefined
  githubRedirectUri: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`
})

const app = createBrowserApp(config, { plugins: () => Promise.resolve([]) })
```

CanFactory production currently points `edgeBaseUrl` at the develop edge,
`https://api.dev.tiny.nntin.xyz`, until that edge is stable, then switches to the production edge.
Both edges allow `https://canfactory.nntin.xyz` and require sign-in for it.

This is the same pattern as [the embed package's minimal host](./embed-package.md#a-minimal-host).
Resolving fills in what you leave out: the default edge URL, storage namespace and auth mode, and a
`githubRedirectUri` derived from `baseUrl` and `origin` when you don't pass one. It also drops
fields you pass as `undefined`, such as a client id your runtime config doesn't have yet.
`createBrowserApp` takes a raw `BrowserShellConfig` too, and its optional fields accept `undefined`,
so that compiles under `exactOptionalPropertyTypes` as well.

- `authMode: 'oauth'` means **sign-in required**. While signed out, `ChatApp` shows a "Sign in with
  GitHub" call to action instead of the chat, and sends nothing to the edge. That includes status
  polling, the model catalogue, MCP discovery and runs. The default `'hybrid'` keeps the anonymous
  composer.
- `githubRedirectUri` must be set: `canStartGitHubOAuth` is `false` without it, because the edge
  could never accept the exchange. Use the non-hash path `/auth/github/callback`
  (`GITHUB_OAUTH_CALLBACK_PATH`). It sits outside `/api/` and needs no client-side router.
- `storageNamespace` scopes the OAuth `state` and the return URL in `sessionStorage`, so the
  callback must be completed with the **same** namespace.

## Completing the callback

GitHub sends the reader back to `GITHUB_OAUTH_CALLBACK_PATH` with `code` and `state`. Most hosts
finish that in their **eager** entry, before their own router reads the URL. Import the
callback helpers from the `@nntin/tinytinkerer-embed/oauth` subpath there:

```ts
import {
  completeGitHubOAuth,
  GITHUB_OAUTH_CALLBACK_PATH,
  isGitHubOAuthCallback,
  type GitHubOAuthCallbackConfig
} from '@nntin/tinytinkerer-embed/oauth'
```

**Never import the package root from eager code.** Most root exports are defined in the runtime's
own chunk, and one static import of those brings the runtime into your startup bundle: before
issue #523, CanFactory measured +437 KB gzipped for a single string constant. Which exports are
cheap from the root is a build detail
([Eager code and lazy code](./embed-package.md#eager-code-and-lazy-code)). The `/oauth` subpath is side-effect free and imports nothing,
neither React nor the runtime. The package's build fails if its graph grows past a few kilobytes,
and the package's acceptance host imports it eagerly and checks its startup bundle's gzipped size.

### In the eager entry, before rendering

```tsx title="src/main.tsx"
import { createRoot } from 'react-dom/client'
import { completeGitHubOAuth, isGitHubOAuthCallback } from '@nntin/tinytinkerer-embed/oauth'
import { App } from './App'
import { assistantOptions } from './assistant-options'

const finishCallback = async (): Promise<void> => {
  if (!isGitHubOAuthCallback()) return
  try {
    const returnUrl = await completeGitHubOAuth(assistantOptions)
    window.history.replaceState(null, '', returnUrl ?? '/')
  } catch (error) {
    // A user-presentable message: missing code, state mismatch, or a failed exchange.
    rememberSignInError(error instanceof Error ? error.message : 'Sign-in failed.')
    window.history.replaceState(null, '', '/')
  }
}

void finishCallback().finally(() => createRoot(document.getElementById('root')!).render(<App />))
```

`assistantOptions` holds the `edgeBaseUrl`, `storageNamespace` and `githubRedirectUri` that your
lazy assistant module also passes to `resolveBrowserShellBootstrapConfig`. Keep it in a small
module that imports only from `/oauth`, so both halves agree on the values.

**Chain the promise; don't `await` it at the top level of the entry.** A top-level `await` in the
entry module deadlocks once anything it awaits loads a lazy chunk, such as your assistant module.
The bundler puts the modules both chunks share (React, your own helpers) in the entry chunk, so the
lazy chunk imports back from the entry. But the entry hasn't finished evaluating: it is suspended on
that same `await`. The import never resolves, the page stays blank on `/auth/github/callback`, and
the state is never consumed. A promise chain lets the entry finish evaluating first. The light
completion below loads no lazy chunk, but keep the chain anyway, so the pattern stays safe when the
callback code changes. A top-level `await` inside the lazy module itself is fine.

### `completeGitHubOAuth(config, url?)` from `/oauth`

```ts
completeGitHubOAuth(
  config: GitHubOAuthCallbackConfig, // { edgeBaseUrl?, storageNamespace?, githubRedirectUri? }
  url?: string | URL
): Promise<string | null>
```

`GitHubOAuthCallbackConfig` is `Pick<BrowserShellConfig, 'edgeBaseUrl' | 'storageNamespace' |
'githubRedirectUri'>`, so the resolved config works too. It needs no `BrowserApp`, and does the
following:

1. Reads `code` and `state` from `url`, which defaults to the current location. It understands
   both a plain query string and the shells' hash-routed `#/auth/callback?…`.
2. Checks `state` against the value the app's sign-in button stored under `storageNamespace` (the
   CSRF check). It rejects if `state` doesn't match or there is no `code`, before any network call.
3. Exchanges the code through the edge's `POST /auth/github/exchange`, sending
   `githubRedirectUri`.
4. Saves the token under `storageNamespace`. The next `initializeBrowserApp` with that namespace
   (that is, the next time your assistant boots, in any tab) moves it into the app's own token
   storage and starts signed in.
5. Resolves to the URL the reader started from, or `null` if none was saved. Only same-origin URLs
   are returned, so the value is always safe to pass to `history.replaceState`, which also removes
   `code` and `state` from the address bar.

`isGitHubOAuthCallback` takes an optional `url` (default: the current location) and is `true` when
its path is `GITHUB_OAUTH_CALLBACK_PATH`. Nothing from `/oauth` is reported to telemetry.

### With an app: `completeGitHubOAuth(app, url?)` from the root

```ts
completeGitHubOAuth(app: BrowserApp, url?: string | URL): Promise<string | null>
```

The root export does the same steps, but signs `app` in directly instead of saving the token for
the next boot. It reports failures to telemetry like the shells' own callback; the authorization
code is never reported. Use it only where the package root is already loaded, in your lazy
assistant module. An app that is already running doesn't see a token that `/oauth`'s
`completeGitHubOAuth` saved until it boots again.

## Security

- **The token lives on your origin.** The GitHub user token (`read:user` scope) is stored in
  IndexedDB under your `storageNamespace`, on your page's origin. Between the light callback and
  the next boot it sits in `localStorage` under the same namespace. Any script that runs on your
  origin can read it, and use the reader's per-GitHub-user LiteLLM budget, which is shared with
  every site on the same edge. Set a Content Security Policy on your host. `script-src 'self'`
  limits what an injected script can do, and `connect-src` must allow your edge's origin and
  `https://api.github.com`: the browser calls `GET https://api.github.com/user` with the token
  directly. TinyTinkerer itself needs no `'unsafe-eval'`. If your own code compiles WebAssembly
  through embind, as MuJoCo does in a physics worker, that worker may need its own CSP with
  `'unsafe-eval'`.
- **The token is sent to the edge and to `api.github.com`.** A `401` from GitHub clears it, so an
  expired token falls back to the sign-in call to action.
- **`REQUIRE_AUTH_ORIGINS` only shapes your own page.** It keeps your page off the anonymous path,
  but doesn't keep anyone else off it (see [How the pieces fit](#how-the-pieces-fit)).

## Limits

- **No localhost sign-in in v1.** The `https://nntin.xyz/` callback does not cover
  `http://localhost:5173`. Test sign-in on a preview origin such as
  `https://canfactory-preview.nntin.xyz`. The develop edge still allows `localhost:5173` for CORS,
  and requires sign-in there.
- **Shared budgets.** A host's signed-in readers get the same per-GitHub-user LiteLLM key as on
  tinytinkerer itself. Budget and rate limits are shared across every site that uses the same edge.
