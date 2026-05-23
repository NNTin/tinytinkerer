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

Start both servers in parallel:

```bash
pnpm dev
```

Or start them individually in separate terminals:

```bash
# Terminal 1 — Edge API (http://localhost:8787)
pnpm --filter @tinytinkerer/edge dev

# Terminal 2 — Web app (http://localhost:5173)
pnpm --filter @tinytinkerer/web dev

# Terminal 3 — Widget shell
pnpm --filter @tinytinkerer/widget dev
```

## Environment variables

The app runs in **local fallback mode** without any API keys — useful for UI development. Features degrade gracefully with a status indicator in the top bar.

### Web — `apps/web/.env`

```bash
VITE_EDGE_URL=http://127.0.0.1:8787
VITE_GITHUB_CLIENT_ID=        # optional: GitHub OAuth app client ID
VITE_GITHUB_REDIRECT_URI=     # optional: OAuth redirect URI
```

### Widget

The widget reads host-controlled runtime config from `window.__TINYTINKERER_WIDGET_CONFIG__`:

```ts
window.__TINYTINKERER_WIDGET_CONFIG__ = {
  edgeBaseUrl: 'http://127.0.0.1:8787',
  storageNamespace: 'tinytinkerer-widget',
  authMode: 'hybrid', // 'oauth' | 'host-token' | 'hybrid'
  hostToken: null,
  githubClientId: '',
  githubRedirectUri: ''
}
```

### Edge — `apps/edge/.dev.vars`

```bash
GITHUB_CLIENT_ID=             # optional: GitHub OAuth app client ID
GITHUB_CLIENT_SECRET=         # optional: GitHub OAuth app client secret
TAVILY_API_KEY=               # optional: enables live web search
```

AI model responses use the signed-in user's GitHub OAuth token — there is no separate `GITHUB_MODELS_TOKEN`. When `TAVILY_API_KEY` is absent the health endpoint reports `"state": "degraded"` for search and mock results are returned instead.

## Other commands

```bash
pnpm check:boundaries   # Workspace boundary and cycle checks
pnpm lint        # ESLint across all packages
pnpm typecheck   # TypeScript across all packages
pnpm test        # Vitest across all packages
pnpm build       # Production build
pnpm format      # Prettier
```

## Project structure

```
apps/
  edge/          # Hono edge API (Cloudflare Workers compatible)
  web/           # React 19 + Vite + Tailwind CSS v4 frontend
  widget/        # Embeddable React widget shell

packages/
  contracts/     # Shared Zod contracts and inferred types
  agent-core/    # AgentRuntime, tool registry, runtime abstractions
  app-core/      # Headless product logic and projections
  app-browser/   # Browser adapters, persistence, runtime wiring
  ui/            # Shared React component library
```
