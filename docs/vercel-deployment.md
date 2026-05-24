# Vercel Deployment Guide

This guide covers the full hosted setup for tinytinkerer:

- Vercel serves the static frontend
- Cloudflare Workers serves the edge API
- GitHub provides user sign-in through an OAuth app
- GitHub Actions deploys `main` and PR previews to Vercel

## Important Naming Note

The current codebase expects a **GitHub OAuth App**, not a GitHub App installation flow.

- Use a GitHub OAuth app for `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `VITE_GITHUB_CLIENT_ID`
- Do not create a GitHub App unless you plan to change the authentication implementation
- GitHub Actions deployment does not need a GitHub App; it uses the repository `GITHUB_TOKEN` plus Vercel secrets

## Architecture

- Frontend production alias: `https://tiny.nntin.xyz`
- Frontend PR preview aliases: `https://pr-<number>-<branch>.tiny.preview.nntin.xyz`
- Edge API: deploy this separately on Cloudflare Workers at a stable URL such as `https://api.tiny.preview.nntin.xyz`

The frontend talks directly to the Cloudflare edge origin through `VITE_EDGE_URL`.

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
- Registering a root callback such as `https://nntin.xyz/` leaves room for `https://tiny.nntin.xyz/#/auth/callback` and `https://pr-123-branch.tiny.preview.nntin.xyz/#/auth/callback`

If you set a fixed `VITE_GITHUB_REDIRECT_URI` in Vercel, preview auth will stop being dynamic. Leave that variable unset unless you intentionally want a fixed callback URL.

### 1.2 Add GitHub Repository Secrets

In the GitHub repository:

1. Open `Settings` -> `Secrets and variables` -> `Actions`
2. Add:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

The deploy workflow at `.github/workflows/deploy-pages.yml` uses those secrets for both production and preview deploys.

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

Set these variables in Vercel for both **Production** and **Preview**:

```bash
VITE_EDGE_URL=https://api.tiny.preview.nntin.xyz
VITE_GITHUB_CLIENT_ID=<your-github-oauth-client-id>
```

Optional:

```bash
VITE_GITHUB_REDIRECT_URI=
```

Leave `VITE_GITHUB_REDIRECT_URI` unset for the preview-friendly default behavior.

### 2.3 Add Custom Domains

Add these domains to the Vercel project:

- `tiny.nntin.xyz`
- `*.tiny.preview.nntin.xyz`

This repo's deploy workflow aliases:

- `main` to `tiny.nntin.xyz`
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

Deploy it as a Cloudflare Worker with a stable public URL such as:

- `https://api.tiny.preview.nntin.xyz`

The Worker config starts in `apps/edge/wrangler.jsonc`.

### 3.2 Set Worker Secrets and Vars

Set the required secrets:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Optional:

```bash
wrangler secret put TAVILY_API_KEY
```

Set plain-text vars for CORS:

```bash
ALLOWED_ORIGINS=http://localhost:3000,https://tiny.nntin.xyz,https://*.tiny.preview.nntin.xyz
```

Why this matters:

- the frontend is hosted on Vercel
- the API is hosted on Cloudflare
- preview frontends therefore call the API cross-origin
- the edge service must explicitly allow both the stable production hostname and wildcard preview hostnames

### 3.3 Attach a Custom Domain

Attach your Worker to a public HTTPS hostname in your Cloudflare zone, such as:

- `api.tiny.preview.nntin.xyz`

Then point `VITE_EDGE_URL` in Vercel to that exact origin.

### 3.4 Deploy the Worker

From the repo root:

```bash
pnpm --filter @tinytinkerer/edge build
pnpm --filter @tinytinkerer/edge exec wrangler deploy
```

After deploy, verify:

```bash
curl https://api.tiny.preview.nntin.xyz/health
```

With OAuth configured, the `auth.state` value in `/health` should report `ready` instead of `degraded`.

## 4. End-to-End Wiring

Once all three systems are configured:

1. Cloudflare exposes the edge API on a stable URL
2. Vercel builds the frontend with `VITE_EDGE_URL` pointing at that URL
3. GitHub Actions deploys `main` and PR previews to Vercel
4. GitHub OAuth redirects users back to the active Vercel origin
5. Cloudflare CORS allows the production alias and preview wildcard domains

## 5. Verification Checklist

### Production

1. Push to `main`
2. Wait for the `Deploy Vercel` workflow to finish
3. Open `https://tiny.nntin.xyz`
4. Confirm the app loads
5. Confirm sign-in works
6. Confirm API requests hit the Cloudflare edge origin

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

### Workflow fails before deploy

Usually caused by one of these:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, or `VERCEL_PROJECT_ID` is missing in GitHub Actions secrets
- the Vercel project is not linked correctly
- the custom domains were not added to the Vercel project

## References

- GitHub OAuth app creation: https://docs.github.com/en/developers/apps/creating-an-oauth-app
- GitHub OAuth redirect rules: https://docs.github.com/apps/building-oauth-apps/authorizing-oauth-apps
- Vercel custom domains: https://vercel.com/docs/domains/set-up-custom-domain
- Vercel wildcard domains: https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers
- Cloudflare Workers custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
