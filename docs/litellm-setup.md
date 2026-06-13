# LiteLLM Setup Guide

tinytinkerer has exactly one model provider: a [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy).
The edge Worker forwards every chat completion and model-list request to the
LiteLLM instance configured by its deployment. It identifies the caller through
GitHub, provisions a LiteLLM virtual key for that GitHub account with per-user
budgets and rate limits, and sends upstream requests with that user's key. There
is no code-level fallback — a deployment without a configured LiteLLM instance
and key-management credentials serves `503 LiteLLM is not configured.` and
`/health` reports `models.state: degraded`.

This guide explains how to host your own LiteLLM instance and point a
tinytinkerer deployment at it. For the rest of the hosted setup (Vercel,
Cloudflare, GitHub OAuth) see [vercel-deployment.md](vercel-deployment.md).

## Architecture Overview

```mermaid
graph LR
    U["👤 User<br/>(Browser)"]
    F["🖥️ Frontend/App<br/>knows: GitHub Token"]
    E["⚙️ Edge Worker<br/>knows:<br/>• LITELLM_KEY_MANAGEMENT_API_KEY<br/>• LITELLM_USER_KEY_SECRET<br/>• per-user derived keys"]
    L["🔐 LiteLLM Proxy<br/>knows:<br/>• LITELLM_MASTER_KEY<br/>• virtual keys in DB<br/>• per-user budgets"]
    GH["📦 GitHub Models<br/>knows: GITHUB_MODELS_TOKEN"]
    CG["🤖 ChatGPT<br/>knows: OAuth tokens"]
    
    U -->|sends chat requests| F
    F -->|POST /api/chat<br/>sends GitHub token| E
    E -->|POST /v2/key/info<br/>Bearer: management key| L
    E -->|POST /key/generate<br/>Bearer: management key| L
    E -->|POST /v1/chat/completions<br/>Bearer: derived user key| L
    E -->|GET /v1/models<br/>Bearer: derived user key| L
    L -->|query models by alias| GH
    L -->|query models by alias| CG
    F -->|streams responses| U
    
    style U fill:#e1f5ff
    style F fill:#f3e5f5
    style E fill:#fff3e0
    style L fill:#fce4ec
    style GH fill:#e8f5e9
    style CG fill:#e8f5e9
```

**Key security properties:**
- **User** only knows their GitHub token (never sees LiteLLM keys)
- **Frontend** never touches LiteLLM keys; it only relays the user's GitHub token to the edge
- **Edge** knows the management key (for provisioning) and derives user-specific keys deterministically
- **LiteLLM Proxy** stores and enforces budgets, rate limits, and per-user model scopes
- **Backend providers** (GitHub Models, ChatGPT) never interact with tinytinkerer directly; all traffic flows through LiteLLM

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
works as long as the instance is reachable over HTTPS and backed by a Postgres
database (Postgres is required for virtual keys and budget tracking). The minimal
self-hosted shape is Docker Compose with two containers: the proxy and a
Postgres database.

`docker-compose.yml`:

```yaml
services:
  litellm:
    image: docker.litellm.ai/berriai/litellm:main-stable
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    ports:
      - "4000:4000"
    volumes:
      - ./config.yaml:/app/config.yaml:ro
    environment:
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
      DATABASE_URL: postgresql://litellm:${POSTGRES_PASSWORD}@litellm-db:5432/litellm
      STORE_MODEL_IN_DB: "True"
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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -d litellm -U litellm"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  litellm-db-data:
```

`config.yaml` — list the models you want to expose. tinytinkerer shows model
IDs verbatim in its picker, and prefixed names (`openai/…`, `anthropic/…`,
`github/…`, etc.) double as the publisher label:

```yaml
model_list:
  - model_name: openai/gpt-5
    litellm_params:
      model: openai/gpt-5
      api_key: os.environ/OPENAI_API_KEY
  - model_name: openai/gpt-4.1-mini
    litellm_params:
      model: openai/gpt-4-turbo
      api_key: os.environ/OPENAI_API_KEY
  - model_name: github/gpt-5
    litellm_params:
      model: github/gpt-5
      api_key: os.environ/GITHUB_MODELS_TOKEN
  - model_name: anthropic/claude-sonnet-4-6
    litellm_params:
      model: claude-3-5-sonnet-20241022
      api_key: os.environ/ANTHROPIC_API_KEY

litellm_settings:
  telemetry: false
  database_url: os.environ/DATABASE_URL
  master_key: os.environ/LITELLM_MASTER_KEY

general_settings:
  log_level: WARNING
```

Notes:

- The proxy reads `config.yaml` **at startup only** — restart the container
  after changing the model list.
- **Disable telemetry** (`telemetry: false`) to keep conversation content private
  and maintain user privacy (see [PRIVACY.md](PRIVACY.md)).
- When a chat request arrives without an explicit model, the edge defaults to
  `openai/gpt-5`. Either expose a model under that name or change
  `DEFAULT_LITELLM_MODEL` in `packages/shared/contracts/src/edge.ts`.
- Embedding models can stay in the list; the edge filters them out of the chat
  picker via `/model/info` modes (or a name heuristic when that endpoint is
  unavailable).
- Use meaningful model aliases that users will recognize. The edge caches the
  model list, so expect up to 5 minutes of staleness after config changes.

Put the proxy behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik,
a tunnel — whatever you already run) so it is reachable at a stable
`https://` hostname. The edge refuses plain-HTTP base URLs.

## 2. Create secrets for per-user key management

### Create a proxy-admin service user

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

The response contains the key value (`sk-…`). That becomes your Worker secret
`LITELLM_KEY_MANAGEMENT_API_KEY`. The edge uses this key only for the
key-management endpoints:
- `POST /v2/key/info` — look up existing per-user keys by alias
- `POST /key/generate` — create new per-user keys
- `POST /key/update` — reconcile budget/rate/model changes

The edge does not use this key for chat requests; each user gets their own
derived virtual key scoped to their budget, rate limits, and allowed models.

**Run this from a trusted admin context** (e.g., the LiteLLM host, Docker
network, or bastion host). You do not need to expose `/user/new` publicly for
tinytinkerer; the edge only requires public access to the three key-management
paths listed above.

### Generate a per-user key derivation secret

Create a separate random secret for `LITELLM_USER_KEY_SECRET`:

```bash
openssl rand -hex 32
```

This becomes your Worker secret `LITELLM_USER_KEY_SECRET`. The edge uses it to
derive stable, deterministic per-user LiteLLM virtual key values from the GitHub
numeric user ID. Because the derivation is deterministic:
- The edge can create a key once and reuse it across requests
- Key aliases never disagree with their values (LiteLLM can verify identity)
- Per-deployment isolation comes from giving each deployment its own secret

**Do not rotate this secret lightly.** Rotating it causes the edge to provision
new per-user keys on next sign-in, potentially forking user spend history. If
you must rotate it, clear the browser cache (Settings → Refresh) and set hard
limits on the old key in LiteLLM as a safety net.

### Per-user budgets

Starting from this version, the edge automatically creates and manages per-user
virtual keys with configurable budgets and rate limits. Each GitHub user gets
their own scoped key with:

- **Max budget** (`LITELLM_USER_MAX_BUDGET_USD`, default `1`) — spend cap per
  budget period
- **Budget duration** (`LITELLM_USER_BUDGET_DURATION`, default `30d`) — when the
  budget resets
- **RPM limit** (`LITELLM_USER_RPM_LIMIT`, default `10`) — requests per minute
- **TPM limit** (`LITELLM_USER_TPM_LIMIT`, default `100000`) — tokens per minute
- **Model scope** (`LITELLM_USER_MODELS`, optional) — comma-separated allowed
  model aliases; empty means all configured models

If a previous deployment used a shared key, that key and its associated spend
history remain in LiteLLM. The new per-user keys will coexist. If you want to
retire the old key:

1. Update its `max_budget` in LiteLLM to `0` (prevents new requests)
2. Keep its spend history for auditing
3. Monitor the old key for any stale Worker traffic
4. Once confirmed unused, delete it

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
# Management
LITELLM_KEY_MANAGEMENT_API_KEY=sk-...
LITELLM_USER_KEY_SECRET=<32-byte hex from openssl rand -hex 32>

# Instance routing
LITELLM_BASE_URL=https://litellm.example.com/
LITELLM_ALLOWED_BASE_URLS=https://litellm.example.com/

# Per-user budgets and rate limits
LITELLM_USER_MAX_BUDGET_USD=1
LITELLM_USER_BUDGET_DURATION=30d
LITELLM_USER_RPM_LIMIT=10
LITELLM_USER_TPM_LIMIT=100000

# Optional: scope generated keys to specific models
# LITELLM_USER_MODELS=openai/gpt-5,openai/gpt-4.1-mini,github/gpt-5

# Optional: restrict access to specific GitHub users
# GITHUB_ALLOWED_USERS=12345,user-login
```

### Optional: let users pick between instances

`LITELLM_ALLOWED_BASE_URLS` can hold several comma-separated URLs. Users can
then enter any allowed URL in **Settings → LiteLLM base URL**; requests to a
URL not on the list are rejected with `400 LiteLLM base URL is not allowed`.

## 4. Verify

### Test the management key and instance health

1. Verify the LiteLLM instance is reachable and the management key works:

   ```bash
   curl -sS https://litellm.example.com/v2/key/info \
     -H "Authorization: Bearer $LITELLM_KEY_MANAGEMENT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"key_aliases": []}'
   ```

   A healthy response is a JSON object with an `info` array (possibly empty for a
   fresh instance). A `401` indicates an invalid management key.

2. Smoke-test the configured models. First, sign in through the app to trigger
   per-user key provisioning. Then, retrieve the generated user key from the
   LiteLLM dashboard (`key/key_alias` for your user) and test a chat request:

   ```bash
   curl -sS https://litellm.example.com/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_USER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-5",
       "messages": [{"role": "user", "content": "ping"}]
     }'
   ```

   A model appearing in `/v1/models` does not guarantee it is callable — this
   smoke test proves the upstream provider credentials work.

### Verify the edge

```bash
curl -sS https://api.your-domain.example/health
```

Check the `models` field:
- `models.state: "ready"` — all required configuration is present
- `models.state: "degraded"` — `LITELLM_BASE_URL` is absent/invalid, or
  `LITELLM_KEY_MANAGEMENT_API_KEY` / `LITELLM_USER_KEY_SECRET` is missing

### Verify the app

1. Sign in with a GitHub account
2. Open the model picker (Settings → Choose Model or in the chat interface)
3. Confirm your models appear
4. Send a test message and confirm the response streams back

Note: Two caches sit between the frontend and the instance:
- **Edge cache** — model list cached for 5 minutes per base URL
- **Browser cache** — model list cached in memory (Settings → Refresh bypasses
  the browser cache only, not the edge cache)

After changing `config.yaml`, restart the LiteLLM container and expect up to 5
minutes of staleness in the browser.

## Troubleshooting

| Symptom | Likely cause | How to debug |
|---|---|---|
| `503 LiteLLM is not configured.` | `LITELLM_BASE_URL` unset / not `https://` / contains credentials, query, or fragment | Check Worker vars in the Vercel/Cloudflare dashboard; verify the URL format with `/health` endpoint |
| `503 LiteLLM user key provisioning is not configured.` | `LITELLM_KEY_MANAGEMENT_API_KEY` or `LITELLM_USER_KEY_SECRET` missing or unset | Confirm both secrets are deployed via `wrangler secret list` or the Worker secrets dashboard |
| `503 LiteLLM user key provisioning is temporarily unavailable.` | LiteLLM endpoint failed, management key is invalid, or reverse-proxy blocks `/v2/key/info`, `/key/generate`, `/key/update` | Test the management key manually: `curl -H "Authorization: Bearer $KEY" https://litellm.example.com/v2/key/info -d '{"key_aliases":[]}' -H 'Content-Type: application/json'` |
| `400 LiteLLM base URL is not allowed` | A Settings override points at a URL not in `LITELLM_ALLOWED_BASE_URLS` | Review Settings → LiteLLM base URL and compare to Worker `vars` |
| `401 Authentication failed.` | User's virtual key was deleted, or doesn't exist in the LiteLLM instance | Sign in again to trigger re-provisioning; check LiteLLM dashboard for the user's key (`tinytinkerer-<hash>-github-<id>`) |
| `403 Access denied.` | User key exists but model scope or `GITHUB_ALLOWED_USERS` doesn't match | Check the key's `models` array in LiteLLM; verify user GitHub ID/login against `GITHUB_ALLOWED_USERS` |
| `429` rate limit in app | User hit their per-key RPM/TPM limit, or upstream provider rate-limited | Check the user's key spend/usage in LiteLLM dashboard; adjust `LITELLM_USER_RPM_LIMIT` or `LITELLM_USER_TPM_LIMIT` if needed |
| Models missing from picker | `LITELLM_USER_MODELS` out of sync, proxy not restarted, or edge cache stale | Restart LiteLLM, wait 5 minutes for edge cache to expire, or manually refresh in Settings |
| User key doesn't exist after sign-in | Management key lacks permission, key-management endpoints unreachable, or derivation secret changed | Check management key logs in LiteLLM; verify routes are exposed in Traefik/reverse-proxy; do not rotate `LITELLM_USER_KEY_SECRET` without clearing browser cache |
| Budget exceeded (`402` or similar) | User hit their `LITELLM_USER_MAX_BUDGET_USD` cap for the period | Check key spend in LiteLLM dashboard; wait for budget reset (duration: `LITELLM_USER_BUDGET_DURATION`, default `30d`) or increase the budget limit |
