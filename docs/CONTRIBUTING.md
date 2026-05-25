# Contributing

## Prerequisites

- **Node.js 22+** — Wrangler (used by `apps/edge`) requires Node.js v22 or later.
  If you are using [nvm](https://github.com/nvm-sh/nvm), run:
  ```bash
  nvm install 22
  nvm use 22
  ```
  A `.nvmrc` file is included at the repo root so `nvm use` works without arguments.

- **pnpm 9.12.0** — managed via [Corepack](https://nodejs.org/api/corepack.html):
  ```bash
  corepack enable
  ```

## Setup

```bash
corepack enable
nvm use          # picks v22 from .nvmrc
pnpm install
```

## Running locally

Start local development:

```bash
pnpm dev
```

This runs:

- Edge API (`http://localhost:8787`)
- Frontend host (`http://localhost:3000/`)
  - Composite: `http://localhost:3000/`
  - Web: `http://localhost:3000/web/`
  - Widget: `http://localhost:3000/widget/`
  - Mobile: `http://localhost:3000/mobile/`

If port `3000` is occupied and `PORT` is not set, the frontend host automatically falls back to a free local port and logs the resolved URLs.

Or start them individually in separate terminals:

```bash
# Terminal 1 — Edge API (http://localhost:8787)
pnpm --filter @tinytinkerer/edge dev

# Terminal 2 — Frontend host (http://localhost:3000)
pnpm --filter @tinytinkerer/host dev
```

## Environment variables

The app runs in **local fallback mode** without any API keys — useful for UI development. Features degrade gracefully with a status indicator in the top bar.

### Web — `apps/web/.env`

```bash
VITE_EDGE_URL=               # optional in local host dev; required for deployed builds
VITE_GITHUB_CLIENT_ID=        # optional: GitHub OAuth app client ID
VITE_GITHUB_REDIRECT_URI=     # optional: defaults to /web/#/auth/callback
```

When you run through `pnpm dev`, the unified host proxies `/health`, `/api/*`, and `/auth/github/exchange`, so `VITE_EDGE_URL` can be omitted for local same-origin development. For deployed builds, set `VITE_EDGE_URL` to the deployed edge origin. If `VITE_GITHUB_REDIRECT_URI` is omitted, the web app derives the callback from the current origin, which allows Vercel preview domains to complete OAuth.

### Widget

The widget reads host-controlled runtime config from `window.__TINYTINKERER_WIDGET_CONFIG__`:

```ts
window.__TINYTINKERER_WIDGET_CONFIG__ = {
  edgeBaseUrl: '', // same-origin through the unified host, or the deployed edge origin
  storageNamespace: 'tinytinkerer-widget',
  authMode: 'hybrid', // 'oauth' | 'host-token' | 'hybrid'
  hostToken: null,
  githubClientId: '',
  githubRedirectUri: 'http://localhost:3000/widget/#/auth/callback'
}
```

For standalone widget embedding outside the unified host, set `edgeBaseUrl` to the edge deployment origin explicitly. If `githubRedirectUri` is omitted but OAuth is enabled, the widget derives the callback from the current origin.

### Mobile — `apps/mobile/.env`

```bash
VITE_EDGE_URL=               # optional in local host dev; required for deployed builds
VITE_GITHUB_CLIENT_ID=        # optional: GitHub OAuth app client ID
VITE_GITHUB_REDIRECT_URI=     # optional: defaults to /mobile/#/auth/callback
```

Like web, mobile can rely on same-origin requests in unified local development. For deployed builds, point `VITE_EDGE_URL` at the deployed edge origin.

### Edge — `apps/edge/.dev.vars`

```bash
GITHUB_CLIENT_ID=             # optional: GitHub OAuth app client ID
GITHUB_CLIENT_SECRET=         # optional: GitHub OAuth app client secret
TAVILY_API_KEY=               # optional: enables live web search
ALLOWED_ORIGINS=http://localhost:3000,https://tiny.nntin.xyz,https://*.tiny.preview.nntin.xyz
```

`ALLOWED_ORIGINS` is a comma-separated CORS allowlist. Use it for local dev plus deployed frontend origins. Wildcard entries in the form `https://*.tiny.preview.nntin.xyz` are supported for preview subdomains. `ALLOWED_ORIGIN` remains supported as a single-origin fallback, but `ALLOWED_ORIGINS` should be preferred.

AI model responses use the signed-in user's GitHub OAuth token — there is no separate `GITHUB_MODELS_TOKEN`. When `TAVILY_API_KEY` is absent the health endpoint reports `"state": "degraded"` for search and mock results are returned instead.

## Other commands

```bash
pnpm check:boundaries   # Workspace boundary and cycle checks
pnpm lint        # ESLint across all packages
pnpm typecheck   # TypeScript across all packages
pnpm test        # Vitest across all packages
pnpm build       # Produces the composed static deployment artifact at apps/host/dist
pnpm build:pages # Produces the legacy GitHub Pages-flavored artifact
pnpm format      # Prettier
```

## Project structure

```
apps/
  edge/          # Hono edge API (Cloudflare Workers compatible)
  host/          # Unified frontend host and composed static deployment output
  mobile/        # Mobile React frontend
  web/           # React 19 + Vite + Tailwind CSS v4 frontend
  widget/        # Embeddable React widget shell

packages/
  contracts/     # Shared Zod contracts and inferred types
  agent-core/    # AgentRuntime, tool registry, runtime abstractions
  app-core/      # Headless product logic and projections
  app-browser/   # Browser adapters, persistence, runtime wiring
  ui/            # Shared React component library
```
