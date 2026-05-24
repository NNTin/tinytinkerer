# tinytinkerer

Frontend-first AI workspace with a stateless edge backend.

## Quick start

```bash
corepack enable
nvm use          # requires Node.js 22+ (see .nvmrc)
pnpm install
pnpm dev
```

- Frontend host: `http://localhost:3000/` (web)
  - Widget: `http://localhost:3000/widget/`
  - Mobile: `http://localhost:3000/mobile/`
- Edge API: `http://localhost:8787`

`pnpm build` composes the static deployment artifact at `apps/host/dist`.

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for full setup instructions, environment variables, and project structure.
