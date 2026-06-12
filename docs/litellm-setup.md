# LiteLLM Setup Guide

tinytinkerer has exactly one model provider: a [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy).
The edge Worker forwards every chat completion and model-list request to the
LiteLLM instance configured by its deployment. It identifies the caller through
GitHub, provisions a LiteLLM virtual key for that GitHub account, and sends
upstream requests with that user's key. There is no code-level fallback - a
deployment without a configured LiteLLM instance and key-management credentials
serves `503 LiteLLM is not configured.` and `/health` reports
`models.state: degraded`.

This guide explains how to host your own LiteLLM instance and point a
tinytinkerer deployment at it. For the rest of the hosted setup (Vercel,
Cloudflare, GitHub OAuth) see [vercel-deployment.md](vercel-deployment.md).

## How tinytinkerer talks to LiteLLM

The edge (`apps/edge`) calls three OpenAI-compatible data-plane endpoints on the
instance:

| Endpoint | Used for | Required |
|---|---|---|
| `POST /v1/chat/completions` | Chat (streaming and non-streaming) | yes |
| `GET /v1/models` | The model picker catalogue | yes |
| `GET /model/info` | Best-effort `mode` lookup so embedding models are hidden from the chat picker | no — falls back to a name heuristic |

It also calls LiteLLM key-management endpoints to create and maintain per-user
virtual keys:

| Endpoint | Used for | Required |
|---|---|---|
| `POST /v2/key/info` | Look up an existing per-user key by alias | yes |
| `POST /key/generate` | Create the per-user key on first use | yes |
| `POST /key/update` | Reconcile budget/rate/model settings when Worker vars change | yes |

Configuration lives in these Worker values:

- `LITELLM_BASE_URL` (var) — the instance the edge calls by default.
- `LITELLM_ALLOWED_BASE_URLS` (var) — comma-separated allowlist. Signed-in
  users may override the base URL in Settings, but the edge only accepts URLs
  on this list (the configured `LITELLM_BASE_URL` is always allowed).
- `LITELLM_KEY_MANAGEMENT_API_KEY` (secret) — a LiteLLM virtual key for a
  proxy-admin service user. The edge uses it only for `/v2/key/info`,
  `/key/generate`, and `/key/update`.
- `LITELLM_USER_KEY_SECRET` (secret) — a high-entropy secret used to derive
  stable LiteLLM virtual key values for each GitHub account. Rotating it makes
  the edge provision new per-user keys.
- `LITELLM_USER_MAX_BUDGET_USD` (var, default `1`) — hard budget for each
  generated user key.
- `LITELLM_USER_BUDGET_DURATION` (var, default `30d`) — budget reset duration.
- `LITELLM_USER_RPM_LIMIT` (var, default `10`) — request-per-minute limit for
  each generated user key.
- `LITELLM_USER_TPM_LIMIT` (var, default `100000`) — token-per-minute limit for
  each generated user key.
- `LITELLM_USER_MODELS` (var, optional) — comma-separated LiteLLM model aliases
  assigned to generated user keys. Empty means all configured models.
- `GITHUB_ALLOWED_USERS` (var, optional) — comma-separated GitHub numeric ids or
  logins allowed to use model/search/MCP routes. Empty allows any valid GitHub
  token.

The edge validates the base URL strictly: it must be `https://`, with no
username/password, query string, or fragment. A plain-HTTP or otherwise
malformed URL is treated as "not configured".

Chat requests are enforced by LiteLLM per GitHub account. The edge verifies the
caller with GitHub's `/user` API, reads the returned `id` and `login`, and then
uses or provisions a key alias like `tinytinkerer-github-<id>` with
`user_id=github-<id>`. See [PRIVACY.md](PRIVACY.md) for the full data-flow
description, and keep those statements true for your own instance (notably:
LiteLLM vendor telemetry disabled, no logging of conversation content).

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

## 2. Create a management service user for tinytinkerer

Never hand the edge your `LITELLM_MASTER_KEY`. Create a dedicated LiteLLM
proxy-admin service user and use its auto-created
[virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys) instead:

```bash
curl -sS http://localhost:4000/user/new \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "tinytinkerer-edge-management",
    "user_alias": "tinytinkerer Edge Management",
    "user_role": "proxy_admin",
    "auto_create_key": true,
    "key_alias": "tinytinkerer-edge-management",
    "models": ["no-default-models"],
    "metadata": {
      "app": "tinytinkerer",
      "purpose": "edge per-user key provisioning"
    }
  }'
```

The response contains the key (`sk-…`) — that value becomes the Worker secret
`LITELLM_KEY_MANAGEMENT_API_KEY`. The edge does not use this key for chat. It
uses it to read, create, and update per-user `llm_api` keys with the configured
budget, RPM, TPM, and model scope. Store it carefully: the service user is a
LiteLLM proxy admin so it can manage keys.

Run this from a trusted admin context, such as the LiteLLM host or Docker
network. You do not need to expose `/user/new` publicly for tinytinkerer; the
edge only needs public access to `/v2/key/info`, `/key/generate`, and
`/key/update`.

Create a separate random secret for `LITELLM_USER_KEY_SECRET`. A 32-byte value is
enough:

```bash
openssl rand -hex 32
```

The edge derives deterministic per-user key values from this secret, the
LiteLLM base URL, and the GitHub numeric id. LiteLLM stores spend against those
virtual keys, so budget/rate enforcement and per-user spend visibility live in
LiteLLM.

### Legacy shared-key safety net

Older tinytinkerer deployments used one shared LiteLLM virtual key. If that key
still exists while you roll this change out, set hard limits on it in LiteLLM
(`max_budget`, `budget_duration`, `rpm_limit`, and `tpm_limit`) so a rollback or
stale Worker cannot spend without a server-side cap. This dashboard/database
state is not represented in this repo, so record and verify it during incident
response, restores, and LiteLLM migrations.

The hosted legacy key `tinytinkerer-edge-20260606213400` is currently capped at
`max_budget=5`, `budget_duration=30d`, `rpm_limit=30`, and `tpm_limit=300000`.

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

2. Add these GitHub Actions repository secrets:

   ```bash
   LITELLM_KEY_MANAGEMENT_API_KEY
   LITELLM_USER_KEY_SECRET
   ```

   The edge deploy workflow
   (`.github/workflows/deploy-edge.yml`) uploads them to the Worker on every
   deploy via `wrangler deploy --secrets-file`.

   For a manual deploy without CI, set them directly instead:

   ```bash
   pnpm --filter @tinytinkerer/edge exec wrangler secret put LITELLM_KEY_MANAGEMENT_API_KEY
   pnpm --filter @tinytinkerer/edge exec wrangler secret put LITELLM_USER_KEY_SECRET
   ```

### Local development

Create `apps/edge/.dev.vars` (gitignored):

```bash
LITELLM_KEY_MANAGEMENT_API_KEY=sk-...
LITELLM_USER_KEY_SECRET=<hex secret>
LITELLM_BASE_URL=https://litellm.example.com/
LITELLM_ALLOWED_BASE_URLS=https://litellm.example.com/
LITELLM_USER_MAX_BUDGET_USD=1
LITELLM_USER_BUDGET_DURATION=30d
LITELLM_USER_RPM_LIMIT=10
LITELLM_USER_TPM_LIMIT=100000
```

### Optional: let users pick between instances

`LITELLM_ALLOWED_BASE_URLS` can hold several comma-separated URLs. Users can
then enter any allowed URL in **Settings → LiteLLM base URL**; requests to a
URL not on the list are rejected with `400 LiteLLM base URL is not allowed`.

## 4. Verify

1. The instance itself, with the management key:

   ```bash
   curl -sS https://litellm.example.com/v2/key/info \
     -H "Authorization: Bearer $LITELLM_KEY_MANAGEMENT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"key_aliases": []}'
   ```

   A healthy management key should return a JSON object. Then create or refresh
   a user key by signing in through the app and loading the model picker.

   To smoke-test a generated per-user key from the LiteLLM dashboard, use that
   user key (not the management key):

   ```bash
   curl -sS https://litellm.example.com/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_USER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "openai/gpt-5", "messages": [{"role": "user", "content": "ping"}]}'
   ```

   A model being listed does not guarantee it is callable — the smoke test is
   what proves the provider credentials behind it work.

2. The edge:

   ```bash
   curl -sS https://api.your-domain.example/health
   ```

   `models.state` must be `ready`. `degraded` means `LITELLM_BASE_URL` is
   absent/invalid, or `LITELLM_KEY_MANAGEMENT_API_KEY` /
   `LITELLM_USER_KEY_SECRET` is missing on that Worker.

3. The app: sign in, open the model picker, and confirm your models appear.
   Two caches sit between you and the instance — the edge caches the
   catalogue for 5 minutes per base URL, and the browser caches it in memory
   (the refresh button in Settings bypasses the browser cache, not the edge
   cache). After changing the model list, expect up to 5 minutes of staleness.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `503 LiteLLM is not configured.` | `LITELLM_BASE_URL` unset / not `https://` / contains credentials, query, or fragment |
| `503 LiteLLM user key provisioning is not configured.` | `LITELLM_KEY_MANAGEMENT_API_KEY` or `LITELLM_USER_KEY_SECRET` missing |
| `503 LiteLLM user key provisioning is temporarily unavailable.` | LiteLLM key-management endpoint failed, the management key is invalid, or the Traefik/reverse-proxy route blocks `/v2/key/info`, `/key/generate`, or `/key/update` |
| `400 LiteLLM base URL is not allowed` | A Settings override points at a URL missing from `LITELLM_ALLOWED_BASE_URLS` |
| `401 Authentication failed. The LiteLLM user virtual key may be invalid.` | The generated user virtual key was deleted, expired, or doesn't match the instance |
| `403 Access denied.` | The generated user key exists but is not scoped to the requested model, or the GitHub account is not in `GITHUB_ALLOWED_USERS` |
| Models missing from the picker | `LITELLM_USER_MODELS` out of sync with `config.yaml`, proxy not restarted after a config change, or the 5-minute edge cache hasn't expired yet |
| `429` cooldowns in the app | The user's LiteLLM key or upstream provider hit a rate limit; the edge honors `Retry-After` and backs off that user until the window closes |
