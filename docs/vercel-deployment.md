# Vercel Deployment Guide

This guide covers the full hosted setup for tinytinkerer:

- Vercel serves the static frontend
- Cloudflare Workers serves the edge API
- GitHub provides user sign-in through an OAuth app
- GitHub Actions deploys `main`, `develop`, and PR previews to Vercel

The edge also needs a LiteLLM instance to serve models — see
[litellm-setup.md](litellm-setup.md) for hosting one and wiring it in.

## Important Naming Note

The current codebase expects a **GitHub OAuth App**, not a GitHub App installation flow.

- Use a GitHub OAuth app for `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `VITE_GITHUB_CLIENT_ID`
- Do not create a GitHub App unless you plan to change the authentication implementation
- GitHub Actions deployment does not need a GitHub App; it uses the repository `GITHUB_TOKEN` plus Vercel secrets
- GitHub Actions secret names must not start with `GITHUB_`, so this repo uses `OAUTH_GITHUB_CLIENT_ID` and `OAUTH_GITHUB_CLIENT_SECRET` in GitHub Actions and maps them to the Worker runtime secret names during deploy

## Architecture

There are three deployment tiers. Each frontend talks directly to a Cloudflare
edge origin through `VITE_EDGE_URL`:

| Tier | Branch / trigger | Frontend (Vercel) | Edge (Cloudflare) | Frontend Sentry env |
|---|---|---|---|---|
| Production | `main` | `https://tiny.nntin.xyz` | `https://api.tiny.nntin.xyz` | `production` |
| Develop | `develop` | `https://dev.tiny.nntin.xyz` | `https://api.dev.tiny.nntin.xyz` | `develop` |
| PR preview | pull requests | `https://pr-<number>-<branch>.tiny.preview.nntin.xyz` | reuses the **develop** edge | `pr-preview` |
| Local dev | — | `http://localhost:3111` | `http://localhost:8787` | `development` |

Key points:

- Only `main` is the true Vercel *production* deployment. `develop` is a Vercel
  *preview* build aliased to a stable subdomain.
- **PR previews reuse the develop edge** (`api.dev.tiny.nntin.xyz`), not
  production. This lets a PR ship an experimental edge change to `develop`
  without risking production stability.
- Both the develop frontend and PR previews use the Vercel **Preview** env
  scope, so both pull `VITE_EDGE_URL=https://api.dev.tiny.nntin.xyz`.
- The last column is the **frontend** Sentry environment. The **edge** has only
  two environments — `production` and `develop` — because each edge tags events
  by the worker that served them. So a PR preview's own (frontend) errors are
  `pr-preview`, but the edge requests it makes hit the develop edge and are
  tagged `develop`. See [Sentry Environments](#7-sentry-environments).

## 1. GitHub Setup

### 1.1 Create the OAuth App

In GitHub:

1. Go to `Settings` -> `Developer settings` -> `OAuth Apps`
2. Click `New OAuth App`
3. Fill in:
   - Application name: `tinytinkerer`
   - Homepage URL: `https://tiny.nntin.xyz`
   - Authorization callback URL: use a parent-domain root that covers your production and preview subdomains, for example `https://nntin.xyz/`
4. Register the app
5. Copy the **Client ID**
6. Generate and copy the **Client Secret**

Why use a parent-domain callback URL:

- tinytinkerer now derives `redirect_uri` from the current Vercel preview origin
- GitHub's OAuth rules allow the redirect host to vary by subdomain, as long as the registered callback URL still matches the same parent host and the redirect path stays under the registered path
- Registering a root callback such as `https://nntin.xyz/` leaves room for `https://tiny.nntin.xyz/web/#/auth/callback` and `https://pr-123-branch.tiny.preview.nntin.xyz/web/#/auth/callback`

If you set a fixed `VITE_GITHUB_REDIRECT_URI` in Vercel, preview auth will stop being dynamic. Leave that variable unset unless you intentionally want a fixed callback URL.

### 1.2 Add GitHub Repository Secrets

In the GitHub repository:

1. Open `Settings` -> `Secrets and variables` -> `Actions`
2. Add:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `OAUTH_GITHUB_CLIENT_ID`
   - `OAUTH_GITHUB_CLIENT_SECRET`
   - `LITELLM_API_KEY` (see [litellm-setup.md](litellm-setup.md))
   - `TAVILY_API_KEY` (optional)

The deploy workflow at `.github/workflows/deploy-pages.yml` uses those secrets for both production and preview deploys.
The edge deploy workflow at `.github/workflows/deploy-edge.yml` uses the Cloudflare and OAuth secrets.

## 2. Vercel Setup

### 2.1 Create or Link the Project

Create a Vercel project for this repo.

Recommended settings:

- Framework preset: `Other`
- Root directory: repo root
- Build settings: rely on `vercel.json`

This repo already defines:

- `installCommand`: `pnpm install --frozen-lockfile`
- `buildCommand`: `pnpm build`
- `outputDirectory`: `apps/host/dist`

If you want the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` values from a local shell:

```bash
vercel link
cat .vercel/project.json
```

Do not commit `.vercel/`.

### 2.2 Configure Vercel Environment Variables

`VITE_EDGE_URL` is **scope-specific** — this is what routes develop and PR
previews to the develop edge while production stays on the production edge:

| Variable | Production scope | Preview scope |
|---|---|---|
| `VITE_EDGE_URL` | `https://api.tiny.nntin.xyz` | `https://api.dev.tiny.nntin.xyz` |
| `VITE_GITHUB_CLIENT_ID` | `<oauth-client-id>` | `<oauth-client-id>` |

`VITE_SENTRY_ENVIRONMENT` is **not** set in Vercel — it is passed per-job by the
deploy workflow (`production` / `develop` / `pr-preview`) so the same Preview
scope can serve both develop and PR builds with distinct Sentry environments.

Optional:

```bash
VITE_GITHUB_REDIRECT_URI=
```

Leave `VITE_GITHUB_REDIRECT_URI` unset (in both scopes) for the preview-friendly
default behavior — the registered parent-domain OAuth callback already covers
`dev.tiny.nntin.xyz` and the preview wildcard.

### 2.3 Add Custom Domains

Add these domains to the Vercel project:

- `tiny.nntin.xyz`
- `dev.tiny.nntin.xyz`
- `*.tiny.preview.nntin.xyz`

`dev.tiny.nntin.xyz` is not covered by the `*.tiny.preview.nntin.xyz` wildcard
(different parent domain), so it needs its own domain entry and TLS cert.

This repo's deploy workflow aliases:

- `main` to `tiny.nntin.xyz`
- `develop` to `dev.tiny.nntin.xyz`
- PR previews to `pr-<number>-<branch>.tiny.preview.nntin.xyz`

PR previews are only created for pull requests whose branch lives in the same repository. Fork PRs are intentionally skipped because the workflow depends on repository secrets.

Vercel wildcard domains have an important constraint:

- wildcard TLS is easiest when the domain uses Vercel nameservers
- if you keep DNS elsewhere, Vercel documents an `_acme-challenge` delegation fallback for wildcard verification

### 2.4 Create the Vercel Token

Create a Vercel token with permission to deploy the project, then store it in GitHub as `VERCEL_TOKEN`.

The workflow also needs:

- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## 3. Cloudflare Setup

### 3.1 Create the Worker

The edge app lives in `apps/edge`.

Deploy it as a Cloudflare Worker on:

- `https://api.tiny.nntin.xyz`

The Worker config starts in `apps/edge/wrangler.jsonc`.

The repository contains both the production and develop Worker config in
`apps/edge/wrangler.jsonc`. The top-level config is the production Worker; the
`env.develop` block is the develop Worker. `vars` and `routes` are **not**
inherited across wrangler environments, so each is declared in full.

Production (top-level):

- custom domain route: `api.tiny.nntin.xyz`
- `workers_dev: false`
- `ALLOWED_ORIGINS=http://localhost:3111,https://tiny.nntin.xyz`
- `SENTRY_ENVIRONMENT=production`

Develop (`env.develop`, worker name `tinytinkerer-edge-develop`):

- custom domain route: `api.dev.tiny.nntin.xyz`
- `ALLOWED_ORIGINS=http://localhost:3111,https://dev.tiny.nntin.xyz,https://*.tiny.preview.nntin.xyz`
  (the preview wildcard lives here, not on production, because PR previews call
  the develop edge)
- `SENTRY_ENVIRONMENT=develop`

### 3.2 Create the Cloudflare API Token

Create an API token for GitHub Actions.

Recommended scope:

- Worker edit permissions for the target account
- zone access for the `nntin.xyz` zone, because the workflow applies the custom domain route

Save these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### 3.3 Configure Worker Secrets

The Worker requires these secrets:

```bash
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
LITELLM_API_KEY
```

`LITELLM_API_KEY` is the virtual key for the LiteLLM instance named in the
Worker's `LITELLM_BASE_URL` var — see [litellm-setup.md](litellm-setup.md)
for hosting an instance, generating the key, and pointing the vars at it.

In GitHub Actions, store them under these repository secret names instead:

```bash
OAUTH_GITHUB_CLIENT_ID
OAUTH_GITHUB_CLIENT_SECRET
```

The edge deploy workflow maps:

- `OAUTH_GITHUB_CLIENT_ID` -> Worker secret `GITHUB_CLIENT_ID`
- `OAUTH_GITHUB_CLIENT_SECRET` -> Worker secret `GITHUB_CLIENT_SECRET`

Optional:

```bash
TAVILY_API_KEY
```

These are not meant to be set manually in the Cloudflare dashboard for normal deployments. The GitHub Actions workflow uploads them during `wrangler deploy --secrets-file ...`.

For local development, keep using `apps/edge/.dev.vars`.

Why this matters:

- the frontend is hosted on Vercel
- the API is hosted on Cloudflare
- preview frontends therefore call the API cross-origin
- the edge service must explicitly allow both the stable production hostname and wildcard preview hostnames

### 3.4 Deploy From GitHub Actions

The repo now includes `.github/workflows/deploy-edge.yml`.

On every push to `main` or `develop` (touching edge-related paths), it:

- installs dependencies
- builds `apps/edge`
- creates a temporary secrets file from GitHub Actions secrets
- runs `wrangler deploy ... --secrets-file ... <env_flag>`
- runs `wrangler triggers deploy <env_flag>`

`<env_flag>` is empty on `main` (deploys the production Worker) and `--env
develop` on `develop` (deploys `tinytinkerer-edge-develop`). The extra `triggers
deploy` step is important because Cloudflare applies route and custom-domain
changes through trigger deployment.

The worker secrets (`GITHUB_CLIENT_ID`, etc.) are uploaded per environment by
`--secrets-file` on each deploy, so the develop Worker gets its own copy.

#### First develop-edge deploy

The edge workflow is **path-filtered** — a push to `develop` that doesn't touch
edge paths will not run it, so `tinytinkerer-edge-develop` is not created
automatically by an unrelated first push. Bootstrap it once via one of:

- trigger `Deploy Edge` via **workflow_dispatch** on the `develop` branch, or
- a manual deploy:

  ```bash
  pnpm --filter @tinytinkerer/edge exec wrangler deploy --env develop
  pnpm --filter @tinytinkerer/edge exec wrangler triggers deploy --env develop
  ```

Confirm `https://api.dev.tiny.nntin.xyz/health` responds before relying on the
develop frontend or PR previews.

### 3.5 First Deploy Checklist

Before the workflow can succeed, confirm:

- the `nntin.xyz` zone is in the target Cloudflare account
- `api.tiny.nntin.xyz` and `api.dev.tiny.nntin.xyz` are available for Worker
  custom domain attachment
- the GitHub Actions secrets listed above are present
- Vercel Production scope uses `VITE_EDGE_URL=https://api.tiny.nntin.xyz` and
  Preview scope uses `VITE_EDGE_URL=https://api.dev.tiny.nntin.xyz`

### 3.6 Manual Deploy Fallback

If you want to deploy the Worker manually once before enabling CI:

```bash
pnpm --filter @tinytinkerer/edge build
pnpm --filter @tinytinkerer/edge exec wrangler deploy --config apps/edge/wrangler.jsonc
pnpm --filter @tinytinkerer/edge exec wrangler triggers deploy --config apps/edge/wrangler.jsonc
```

After deploy, verify:

```bash
curl https://api.tiny.nntin.xyz/health
```

With OAuth configured, the `auth.state` value in `/health` should report `ready` instead of `degraded`.

## 4. End-to-End Wiring

Once all three systems are configured:

1. Cloudflare exposes the production and develop edge APIs on stable URLs
2. Vercel builds each frontend with `VITE_EDGE_URL` pointing at the right edge
   (production scope → production edge; preview scope → develop edge)
3. GitHub Actions deploys `main`, `develop`, and PR previews to Vercel
4. GitHub Actions deploys the edge Workers to `https://api.tiny.nntin.xyz`
   (`main`) and `https://api.dev.tiny.nntin.xyz` (`develop`)
5. GitHub OAuth redirects users back to the active Vercel origin
6. Cloudflare CORS allows each edge's own frontend origins (production serves
   `tiny.nntin.xyz`; develop serves `dev.tiny.nntin.xyz` + the preview wildcard)

## 5. Verification Checklist

### Production

1. Push to `main`
2. Wait for the `Deploy Vercel` workflow to finish
3. Open `https://tiny.nntin.xyz`
4. Confirm the app loads
5. Confirm sign-in works
6. Confirm API requests hit the Cloudflare edge origin
7. Confirm requests target `https://api.tiny.nntin.xyz`

### Preview

1. Open a PR from a branch in the same repository
2. Wait for the preview job to finish
3. Confirm the PR receives one preview comment
4. Push another commit to the PR
5. Confirm the same comment is updated, not duplicated
6. Open the preview URL and verify sign-in and API access

## 6. Common Failure Modes

### OAuth says `redirect_uri` does not match

Usually caused by one of these:

- the GitHub OAuth app callback URL is too narrow
- `VITE_GITHUB_REDIRECT_URI` was set to a fixed URL in Vercel
- the preview domain is outside the registered parent domain

### Preview deploy succeeds but API calls fail

Usually caused by one of these:

- `VITE_EDGE_URL` is missing in Vercel
- `ALLOWED_ORIGINS` on Cloudflare does not include the preview wildcard
- the Worker custom domain is not active yet
- the edge deploy workflow has not run successfully yet

### Workflow fails before deploy

Usually caused by one of these:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` is missing in GitHub Actions secrets
- the Vercel project is not linked correctly
- the custom domains were not added to the Vercel project

### Edge workflow fails before deploy

Usually caused by one of these:

- `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing in GitHub Actions secrets
- `OAUTH_GITHUB_CLIENT_ID` or `OAUTH_GITHUB_CLIENT_SECRET` is missing in GitHub Actions secrets
- the Cloudflare token does not have enough scope for Workers deploys and zone routing changes
- `api.tiny.nntin.xyz` cannot be provisioned as a Worker custom domain in the target zone

## 7. Sentry Environments

Both Sentry projects (`tinytinkerer-frontend`, `tinytinkerer-edge`) are shared
across tiers and split by the event `environment` tag. **The frontend and edge
do not use the same set of environments** — there is one edge per tier, but PR
previews have their own frontend while reusing the develop edge.

**Frontend** (`tinytinkerer-frontend`) — four environments:

- `development` — localhost (default when `VITE_SENTRY_ENVIRONMENT` is unset)
- `pr-preview` — all PR previews, grouped into one environment
- `develop` — the `develop` branch deployment
- `production` — the `main` branch deployment

**Edge** (`tinytinkerer-edge`) — only two environments, because each worker tags
events by which worker served the request:

- `develop` — the develop worker (`api.dev.tiny.nntin.xyz`). This includes
  requests made by PR previews, since they reuse the develop edge. There is no
  `pr-preview` environment on the edge.
- `production` — the production worker (`api.tiny.nntin.xyz`)

So when triaging an edge error that originated from PR-preview traffic, look
under `develop`, not `pr-preview`. To correlate it with a specific PR preview,
use the frontend event (tagged `pr-preview`) and the shared release (git SHA).

The environment is set explicitly in code (`VITE_SENTRY_ENVIRONMENT` baked into
the frontend build; `SENTRY_ENVIRONMENT` worker var for the edge). The release
stays the 7-char git SHA across all environments — the same commit deployed to
develop and production is intentional and keeps source maps shared.

> **Disable the Vercel↔Sentry integration.** CI already creates Sentry releases
> explicitly (`sentry-cli` for the edge, `@sentry/vite-plugin` for the
> frontend), so the Vercel integration is redundant and is the source of the
> confusing `vercel-production` / `vercel-preview` release-deploy labels. Turn
> it off in the Sentry/Vercel dashboard so the explicit environments above are
> the only ones reported.

## References

- GitHub OAuth app creation: https://docs.github.com/en/developers/apps/creating-an-oauth-app
- GitHub OAuth redirect rules: https://docs.github.com/apps/building-oauth-apps/authorizing-oauth-apps
- Vercel custom domains: https://vercel.com/docs/domains/set-up-custom-domain
- Vercel wildcard domains: https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers
- Cloudflare Workers custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
