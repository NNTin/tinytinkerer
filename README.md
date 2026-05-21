# tinytinkerer

Frontend-first AI workspace with a tiny stateless edge backend.

## Stack

- pnpm workspaces + Turborepo
- React 19 + Vite + Tailwind CSS v4
- Zustand + TanStack Query + React Router + Dexie
- Hono edge APIs (Cloudflare Workers compatible)
- Strict TypeScript across all packages

## Repository layout

```text
apps/
  web/
  edge/

packages/
  agent-core/
  ui/
  shared/
  config/
  types/
```

## Quick start

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
pnpm dev
```

- Web app: `http://127.0.0.1:5173`
- Edge API: `http://127.0.0.1:8787`

## Environment variables

### Web (`apps/web/.env`)

```bash
VITE_EDGE_URL=http://127.0.0.1:8787
VITE_GITHUB_CLIENT_ID=
VITE_GITHUB_REDIRECT_URI=
```

### Edge (`apps/edge/.dev.vars`)

```bash
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_MODELS_TOKEN=
TAVILY_API_KEY=
```

If `GITHUB_MODELS_TOKEN` or `TAVILY_API_KEY` are missing, the app runs in local fallback mode with degraded indicators.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Architecture highlights

- Runtime orchestration lives in `packages/agent-core`
- Planner / Executor / Synthesizer flow emits typed `ChatEvent` records
- UI derives state from event timeline (not mutable assistant blobs)
- Tavily integration is normalized into internal `SearchResult` shape
- Local persistence stores conversations, events, and preferences in Dexie
