# LiteLLM Setup Guide

tinytinkerer has exactly one model provider: a [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy).
The edge Worker forwards every chat completion and model-list request to the
LiteLLM instance configured by its deployment, using a single shared service
credential. There is no code-level fallback — a deployment without a configured
LiteLLM instance serves `503 LiteLLM is not configured.` and `/health` reports
`models.state: degraded`.

This guide explains how to host your own LiteLLM instance and point a
tinytinkerer deployment at it. For the rest of the hosted setup (Vercel,
Cloudflare, GitHub OAuth) see [vercel-deployment.md](vercel-deployment.md).

## How tinytinkerer talks to LiteLLM

The edge (`apps/edge`) calls three OpenAI-compatible endpoints on the instance:

| Endpoint | Used for | Required |
|---|---|---|
| `POST /v1/chat/completions` | Chat (streaming and non-streaming) | yes |
| `GET /v1/models` | The model picker catalogue | yes |
| `GET /model/info` | Best-effort `mode` lookup so embedding models are hidden from the chat picker | no — falls back to a name heuristic |

Configuration lives in three values on the Worker:

- `LITELLM_BASE_URL` (var) — the instance the edge calls by default.
- `LITELLM_ALLOWED_BASE_URLS` (var) — comma-separated allowlist. Signed-in
  users may override the base URL in Settings, but the edge only accepts URLs
  on this list (the configured `LITELLM_BASE_URL` is always allowed).
- `LITELLM_API_KEY` (secret) — the key the edge sends as
  `Authorization: Bearer …` on every upstream call. Use a LiteLLM
  **virtual key**, not the master key (see below).

The edge validates the base URL strictly: it must be `https://`, with no
username/password, query string, or fragment. A plain-HTTP or otherwise
malformed URL is treated as "not configured".

Chat requests carry no user identity to LiteLLM — the edge verifies the
caller's GitHub token first, then forwards the request with only the shared
key. See [PRIVACY.md](PRIVACY.md) for the full data-flow description, and keep
those statements true for your own instance (notably: LiteLLM vendor telemetry
disabled, no logging of conversation content).

## 1. Host a LiteLLM instance

Any deployment style from the [LiteLLM docs](https://docs.litellm.ai/docs/proxy/deploy)
works as long as the instance is reachable over HTTPS. The minimal
self-hosted shape is Docker Compose with two containers: the proxy and a
Postgres database (Postgres is what enables virtual keys).

`docker-compose.yml`:

```yaml
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    command: ["--config", "/app/config.yaml"]
    ports:
      - "4000:4000"
    volumes:
      - ./config.yaml:/app/config.yaml
    environment:
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
      DATABASE_URL: postgresql://litellm:${POSTGRES_PASSWORD}@litellm-db:5432/litellm
      # Provider keys referenced from config.yaml:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      - litellm-db

  litellm-db:
    image: postgres:16
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: litellm
    volumes:
      - litellm-db-data:/var/lib/postgresql/data

volumes:
  litellm-db-data:
```

`config.yaml` — list the models you want to expose. tinytinkerer shows model
IDs verbatim in its picker, and prefixed names (`openai/…`, `anthropic/…`)
double as the publisher label:

```yaml
model_list:
  - model_name: openai/gpt-5
    litellm_params:
      model: openai/gpt-5
      api_key: os.environ/OPENAI_API_KEY
  - model_name: anthropic/claude-sonnet-4-6
    litellm_params:
      model: anthropic/claude-sonnet-4-6
      api_key: os.environ/ANTHROPIC_API_KEY

litellm_settings:
  telemetry: false

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
```

Notes:

- The proxy reads `config.yaml` **at startup only** — restart the container
  after changing the model list.
- When a chat request arrives without an explicit model, the edge defaults to
  `openai/gpt-5` (`DEFAULT_LITELLM_MODEL` in
  `packages/shared/contracts/src/edge.ts`). Either expose a model under that
  name or change the constant in your fork.
- Embedding models can stay in the list; the edge filters them out of the chat
  picker via `/model/info` modes (or a name heuristic when that endpoint is
  unavailable).

Put the proxy behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik,
a tunnel — whatever you already run) so it is reachable at a stable
`https://` hostname. The edge refuses plain-HTTP base URLs.

## 2. Create a virtual key for tinytinkerer

Never hand the edge your `LITELLM_MASTER_KEY`. Generate a scoped
[virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys) instead:

```bash
curl -sS https://litellm.example.com/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_alias": "tinytinkerer-edge",
    "models": []
  }'
```

The response contains the key (`sk-…`) — that value becomes the Worker secret
`LITELLM_API_KEY`. An empty `models` array means the key can call every model
in the config; list explicit model names instead if you want the key (and
therefore tinytinkerer's picker) restricted to a subset. You can also set
`max_budget`, `tpm_limit`, and `rpm_limit` on the key to cap spend — the edge
already converts upstream `429` responses into a durable cooldown shared by
all callers, so rate limits degrade gracefully.

If you scope the key, keep its model list in sync with `config.yaml`: the
catalogue tinytinkerer sees is whatever `/v1/models` returns **for that key**.

## 3. Point tinytinkerer at your instance

### Deployed Workers

1. Edit `apps/edge/wrangler.jsonc` and replace the maintainer's instance with
   yours in **both** the top-level `vars` (production Worker) and
   `env.develop.vars` (develop Worker) — wrangler does not inherit `vars`
   across environments:

   ```jsonc
   "vars": {
     // ...
     "LITELLM_BASE_URL": "https://litellm.example.com/",
     "LITELLM_ALLOWED_BASE_URLS": "https://litellm.example.com/"
   }
   ```

2. Add the virtual key as a GitHub Actions repository secret named
   `LITELLM_API_KEY`. The edge deploy workflow
   (`.github/workflows/deploy-edge.yml`) uploads it to the Worker on every
   deploy via `wrangler deploy --secrets-file`.

   For a manual deploy without CI, set it directly instead:

   ```bash
   pnpm --filter @tinytinkerer/edge exec wrangler secret put LITELLM_API_KEY
   ```

### Local development

Create `apps/edge/.dev.vars` (gitignored):

```bash
LITELLM_API_KEY=sk-...
LITELLM_BASE_URL=https://litellm.example.com/
LITELLM_ALLOWED_BASE_URLS=https://litellm.example.com/
```

### Optional: let users pick between instances

`LITELLM_ALLOWED_BASE_URLS` can hold several comma-separated URLs. Users can
then enter any allowed URL in **Settings → LiteLLM base URL**; requests to a
URL not on the list are rejected with `400 LiteLLM base URL is not allowed`.

## 4. Verify

1. The instance itself, with the virtual key (not the master key):

   ```bash
   curl -sS https://litellm.example.com/v1/models \
     -H "Authorization: Bearer $LITELLM_API_KEY"
   ```

   Every model you expect should be listed. Then a one-message smoke test:

   ```bash
   curl -sS https://litellm.example.com/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "openai/gpt-5", "messages": [{"role": "user", "content": "ping"}]}'
   ```

   A model being listed does not guarantee it is callable — the smoke test is
   what proves the provider credentials behind it work.

2. The edge:

   ```bash
   curl -sS https://api.your-domain.example/health
   ```

   `models.state` must be `ready`. `degraded` means `LITELLM_API_KEY` is
   missing or `LITELLM_BASE_URL` is absent/invalid on that Worker.

3. The app: sign in, open the model picker, and confirm your models appear.
   Two caches sit between you and the instance — the edge caches the
   catalogue for 5 minutes per base URL, and the browser caches it in memory
   (the refresh button in Settings bypasses the browser cache, not the edge
   cache). After changing the model list, expect up to 5 minutes of staleness.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `503 LiteLLM is not configured.` | `LITELLM_API_KEY` secret missing, or `LITELLM_BASE_URL` unset / not `https://` / contains credentials, query, or fragment |
| `400 LiteLLM base URL is not allowed` | A Settings override points at a URL missing from `LITELLM_ALLOWED_BASE_URLS` |
| `401 Authentication failed. The configured LiteLLM virtual key may be invalid.` | The virtual key was deleted, expired, or doesn't match the instance |
| `403 Access denied.` | The virtual key exists but is not scoped to the requested model |
| Models missing from the picker | Key scope out of sync with `config.yaml`, proxy not restarted after a config change, or the 5-minute edge cache hasn't expired yet |
| `429` cooldowns in the app | Upstream provider rate limit; the edge honours `Retry-After` and backs off all callers of the instance until the window closes |
