# Work locally with LiteLLM and extend its public API

Use for: tinytinkerer edge/browser issues that need the real LiteLLM service,
new LiteLLM endpoints that tinytinkerer must call, or PR previews that cannot
be trusted because they reuse the develop edge.

## 1. Establish service state

```bash
.agent/skills/litellm/tools/litellm-status.sh
.agent/skills/litellm/tools/probe-api.sh
```

`probe-api.sh` checks the internal OpenAPI document, internal `/model/info`, and
the public `/model/info` route without printing secrets. The LiteLLM container
image may not have `curl`; prefer the probe script or Python `urllib` through
`docker exec -i litellm python3 -`.

## 2. Inspect OpenAPI or endpoint behavior locally

Public docs routes (`/openapi.json`, `/swagger/*`, `/redoc`) are intentionally
behind Authentik. Inspect OpenAPI from inside the container:

```bash
docker exec -i litellm python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
    "http://localhost:4000/openapi.json",
    headers={"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"]},
)
with urllib.request.urlopen(req, timeout=15) as response:
    paths = sorted(json.load(response)["paths"])
for path in paths:
    if "model" in path:
        print(path)
PY
```

For response-shape work, query the local container first, then the public host.
If local works but public returns a redirect to Authentik, Traefik does not
expose that path yet.

## 3. Expose a new public LiteLLM API path

Edit the LiteLLM service repo:

```bash
SERVICE_DIR=~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm
COMPOSE_ROOT=~/git/lair.nntin.xyz/projects/nntin-labs
git -C "$COMPOSE_ROOT" status --short --branch
```

Update `docker-compose.yml` Traefik labels in `$SERVICE_DIR`, and update
`README.md` plus `Architecture.md` in the same change. Keep admin/control-plane
routes behind Authentik; expose only narrow data-plane or metadata paths that
LiteLLM virtual keys should authorize.

Validate and apply from the compose root that owns the running containers:

```bash
cd "$COMPOSE_ROOT"
docker compose config --quiet
docker compose up -d litellm
docker inspect litellm --format '{{ index .Config.Labels "com.docker.compose.project" }}'
```

The running project is `nntin-labs`; running compose from the service directory
can target the wrong project and fail to update the live container. Recreate only
`litellm` unless the database/config volume must change. Then run:

```bash
.agent/skills/litellm/tools/probe-api.sh
.agent/skills/litellm/tools/litellm-status.sh
.agent/skills/litellm/tools/smoke-test-models.sh chatgpt/gpt-5.4
```

## 4. Mind LiteLLM virtual-key route scopes

LiteLLM's `/key/generate` `key_type: "llm_api"` shortcut overwrites
`allowed_routes` to only `["llm_api_routes"]`. Those keys can call
`/v1/models` and chat completions, but they cannot call metadata endpoints such
as `/model/info`.

When tinytinkerer needs both chat/data-plane and metadata, mint keys without
`key_type` and set explicit route presets:

```json
{
  "allowed_routes": ["llm_api_routes", "info_routes"]
}
```

Existing keys can be repaired in place through `/key/update` with the same
`allowed_routes`; no manual deletion is required. In tinytinkerer this lives in
`apps/edge/src/lib/litellm-user-keys.ts`, not the model-list route.

## 5. Run the local edge worker against real LiteLLM

PR preview frontends may call the shared develop edge. For edge changes, use the
local worker from `docs/vercel-deployment.md`: frontend on `localhost:3111`,
edge on `localhost:8787`.

Avoid committing secrets to `.dev.vars`. Use a temporary env file and remove it
after the run:

```bash
tmp_env="$(mktemp)"
chmod 600 "$tmp_env"
{
  printf 'LITELLM_BASE_URL=https://litellm.labs.lair.nntin.xyz\n'
  printf 'LITELLM_KEY_MANAGEMENT_API_KEY='
  docker exec litellm printenv LITELLM_MASTER_KEY
  printf 'LITELLM_USER_KEY_SECRET=local-litellm-%s\n' "$(date +%s)"
} > "$tmp_env"

pnpm --filter @tinytinkerer/edge exec wrangler dev \
  --port 8787 \
  --ip 127.0.0.1 \
  --show-interactive-dev-session=false \
  --env-file "$tmp_env"

rm -f "$tmp_env"
```

In another shell:

```bash
TINYTINKERER_SKIP_BRAND_ASSET_GENERATION=1 \
pnpm --filter @tinytinkerer/web dev --host 127.0.0.1 --port 3111
```

Do not pass an extra `--` before Vite flags; that makes Vite treat them as
literal app args and it will fall back to its default port.

## 6. Fast Hono-level check without a browser

For edge route debugging, `app.fetch` is faster than starting both servers:

```bash
LITELLM_KEY_MANAGEMENT_API_KEY="$(docker exec litellm printenv LITELLM_MASTER_KEY)" \
pnpm exec tsx <<'TS'
import crypto from 'node:crypto'
import app from './apps/edge/src/index.ts'

const env = {
  LITELLM_BASE_URL: 'https://litellm.labs.lair.nntin.xyz',
  LITELLM_KEY_MANAGEMENT_API_KEY: process.env.LITELLM_KEY_MANAGEMENT_API_KEY,
  LITELLM_USER_KEY_SECRET: `local-litellm-${crypto.randomUUID()}`
}

const response = await app.fetch(
  new Request('http://localhost/api/models/list?provider=litellm'),
  env
)
const body = await response.json() as {
  models?: Array<{ id: string; limits?: unknown }>
  error?: string
}
console.log({
  status: response.status,
  modelCount: body.models?.length ?? 0,
  modelsWithLimits: body.models?.filter((model) => model.limits).map((model) => model.id),
  error: body.error
})
TS
```

This is good for verifying edge contracts such as `ModelEntry.limits`. It does
not prove browser plugin rendering.

## 7. Browser verification checklist

For context-gauge style features, the UI needs both pieces:

- `/api/models/list` includes `limits.max_input_tokens` from LiteLLM
  `/model/info`.
- The final streamed chat request sends `stream_options.include_usage: true`
  and receives a terminal SSE chunk with `usage.prompt_tokens`.

In Playwright, clear IndexedDB as well as local/session storage before judging
state; tinytinkerer persists conversation and settings in IndexedDB. The gauge
is hidden until the plugin is enabled, a context window is known, and usage has
arrived.

## 8. Cleanup

- Stop Wrangler/Vite sessions before responding.
- Remove temporary env files and Playwright scratch output (`.playwright-mcp/`).
- Run `git status --short --branch` in both tinytinkerer and the lair compose
  root.
- Do not commit unless asked.
