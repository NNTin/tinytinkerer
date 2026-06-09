# Diagnose tinytinkerer ↔ LiteLLM errors and stale model lists

Use for: opaque 400/401/429/5xx from the LiteLLM provider, models missing or
stale in tinytinkerer, or "it worked yesterday" reports.

## 1. Establish state first

```bash
.agent/skills/litellm/tools/litellm-status.sh
```

The drift report classifies most "stale models" complaints immediately:

| Drift line | Fix |
| --- | --- |
| in config.yaml but not live | `cd ~/git/lair.nntin.xyz/projects/nntin-labs && docker compose restart litellm` (config is read at startup only) |
| live but not in virtual key | `tools/sync-virtual-key.sh` (dry-run, review, `--apply`) |
| in virtual key but not live | stale scope — same sync, or restore the model via `add-or-remove-model.md` |

## 2. Pull recent service logs

```bash
docker logs litellm --since 30m
```

## 3. Match known failure signatures

- **401 on every LiteLLM request from tinytinkerer** — the edge caller-validation
  probe hits `https://api.github.com/user`, which rejects requests without a
  `User-Agent` header; the edge must send `user-agent: tinytinkerer-edge`
  (fix `cb31ad0`, `apps/edge/src/routes/models.ts`). Distinct from a bad virtual
  key: that 401 comes from LiteLLM itself and shows in `docker logs litellm`.
- **400 with `The '<model>' model is not supported when using Codex with a
  ChatGPT account.`** — the alias is listed but not callable by the stored
  ChatGPT account. Confirm with `tools/smoke-test-models.sh <model>`, then
  retire the alias via `add-or-remove-model.md` (removal path). Never keep an
  unsupported `chatgpt/*` alias as a fallback.
- **429** — the edge keeps a durable backoff per credential and serves
  last-known models; check edge logs/behavior before touching the service.
- **Timeouts / aborts on slow reasoning models** (e.g. `openai/gpt-5`) — a
  two-project cascade, not a service fault. Follow
  `../../sentry-debugging/workflows/diagnose-slow-model-timeout.md`.
- **Auth-shaped errors on `chatgpt/*` models only** (other providers fine) —
  ChatGPT OAuth expired or revoked. Follow `refresh-chatgpt-auth.md`.

## 4. No drift, no errors, list still stale → it's a cache

- tinytinkerer edge caches provider model lists for **5 minutes**.
- the browser keeps an in-memory model cache; the Settings refresh button
  bypasses it.

Wait out / refresh both before digging deeper.

## 5. Still opaque → read the LiteLLM fork source

```bash
rg -n "chatgpt|codex|model is not supported|backend-api/codex" ~/git/litellm -S
```

Checkout is the fork branch `litellm_internal_staging`; the custom ChatGPT
provider lives in `litellm/llms/chatgpt/` (`authenticator.py` for the OAuth
flow, `chat/transformation.py` for request shaping). Proxy error wrapping is in
`litellm/proxy/common_request_processing.py` (`_handle_llm_api_exception`).

## 6. Close out

`tools/litellm-status.sh` exits 0, affected models pass
`tools/smoke-test-models.sh`, and you can state what changed and why.
