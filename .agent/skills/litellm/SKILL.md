# litellm

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # markdown SOPs (step-by-step procedures)
  tools/        # deterministic scripts the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. Scan workflow **filenames** for a relevant SOP — don't read every file.
3. Follow the SOP; run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Operate and debug the hosted LiteLLM service used by tinytinkerer. Three repositories are involved:

- tinytinkerer integration: `~/git/tinytinkerer`
- LiteLLM service deployment: `~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm`
- LiteLLM source checkout: `~/git/litellm` (fork, branch `litellm_internal_staging`, custom ChatGPT provider in `litellm/llms/chatgpt/`)

## When to use

- tinytinkerer's LiteLLM provider fails, lists stale models, or returns opaque 400/401/429/5xx errors.
- A user asks which LiteLLM models are available, supported, or exposed to tinytinkerer.
- You need Docker logs, LiteLLM config, virtual-key scope, or ChatGPT auth state.
- You need to update the hosted LiteLLM service docs or config.
- You need to expose or consume an additional LiteLLM API path, inspect LiteLLM OpenAPI, or test tinytinkerer against a local edge worker.

## How

1. Run `tools/litellm-status.sh` first for any symptom — it prints the three sources of truth and a drift report.
2. Pick the workflow matching the task (filenames below); follow it, running the tools instead of hand-typing docker/psql commands.
3. Check `git status` in the target repo before editing anything; don't trample unrelated changes.

## Tools

All read secrets inside the containers and print only model IDs/statuses — never keys.

- `tools/litellm-status.sh [ALIAS]` — one-shot diagnostic: containers, config.yaml vs live `/v1/models` vs virtual-key scope, drift report. Exit 0 = aligned, 1 = drift, 2 = unreachable.
- `tools/list-live-models.sh [--prefix PREFIX]` — live model IDs, one per line (machine-readable).
- `tools/show-virtual-key.sh [ALIAS] [--models-only]` — virtual-key scope from Postgres.
- `tools/sync-virtual-key.sh [ALIAS] [--apply] [--allow-empty]` — set key scope to the live model list. Dry-run by default; prints the exact SQL.
- `tools/smoke-test-models.sh [MODEL ...]` — minimal chat completion per model (default: all live `chatgpt/*`). `OK`/`ERR` with upstream detail.
- `tools/probe-api.sh [--public-base URL] [--no-public]` — inspect internal OpenAPI path presence, internal `/model/info` token limits, and public `/model/info` routing. Runs inside the LiteLLM container and never prints keys.

## Workflows

- `workflows/diagnose-errors.md` — triage errors and stale model lists; known failure signatures (User-Agent 401, Codex "model not supported" 400, 429 backoff, timeout cascade, auth).
- `workflows/add-or-remove-model.md` — end-to-end rollout/retirement: config → restart → smoke test → key sync → docs.
- `workflows/refresh-chatgpt-auth.md` — ChatGPT OAuth device-code bootstrap/refresh and verification.
- `workflows/local-edge-and-api.md` — inspect OpenAPI, expose new public LiteLLM paths through Traefik, handle virtual-key route scopes, and verify tinytinkerer with a local Hono edge worker.

## Important paths

- Service docs/config (lair repo): `README.md`, `Architecture.md`, `ChatGPT-Models-Runbook.md`, `config.yaml`, `docker-compose.yml` under `~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm/`
- Compose root: `~/git/lair.nntin.xyz/projects/nntin-labs`
- tinytinkerer edge integration: `apps/edge/src/routes/models.ts` (LiteLLM proxying, caching, backoff, caller validation)
- tinytinkerer edge user keys: `apps/edge/src/lib/litellm-user-keys.ts` (per-user/anonymous key minting, budgets, allowed route presets)
- tinytinkerer browser side: `packages/app/app-browser/src/models.ts`, `packages/app/app-browser/src/runtime/litellm-provider.ts`, `packages/app/app-browser/src/runtime/react-decider.ts`

## Live service facts

- Public LiteLLM host: `https://litellm.labs.lair.nntin.xyz`
- Containers: `litellm` (proxy, port 4000, reads bind-mounted `/app/config.yaml` at startup only) and `litellm-db` (Postgres 16).
- ChatGPT OAuth tokens: volume `litellm_chatgpt_auth` at `CHATGPT_TOKEN_DIR=/var/lib/litellm/chatgpt`.
- tinytinkerer's shared virtual key alias: `tinytinkerer-edge-20260606213400` (table `LiteLLM_VerificationToken`; empty `models` array = unrestricted).
- OpenAPI is available inside the container at `http://localhost:4000/openapi.json`; public docs routes stay behind Authentik.
- Public data-plane/metadata routing is controlled by Traefik labels in the service `docker-compose.yml`; if local container access works but the public host redirects to Authentik, the public route label is missing.
- PR preview frontends reuse the develop edge API. For edge changes, run the local Hono worker on `localhost:8787` and the web app on `localhost:3111` per `docs/vercel-deployment.md`.

## Model policy

Never expose a `chatgpt/*` alias in `config.yaml` or the virtual-key scope until it passes `tools/smoke-test-models.sh` with the stored ChatGPT auth — **listed in `/v1/models` does not mean callable**. The live inventory comes from the tools, not from this file; dated history of which aliases the account accepts/rejects lives in the lair repo's `ChatGPT-Models-Runbook.md`.

## Triage invariants

- Three sources of truth drift independently: `config.yaml` (desired, needs restart to load), live `/v1/models` (running process), and the virtual key's `models` array (what tinytinkerer sees). `tools/litellm-status.sh` shows all three.
- Two caches sit downstream: the tinytinkerer edge caches model lists for 5 minutes; the browser caches in memory (Settings refresh bypasses).
- An unsupported `chatgpt/*` alias must be removed from config and key scope — never kept as a fallback.
- The LiteLLM container image may not have `curl`; use Python `urllib` via `docker exec -i litellm python3 -` or the provided tools.
- LiteLLM `key_type: "llm_api"` on `/key/generate` overwrites `allowed_routes` to `["llm_api_routes"]`. If tinytinkerer needs metadata endpoints such as `/model/info`, mint/update keys without `key_type` and set `allowed_routes: ["llm_api_routes", "info_routes"]`.
- `/model/info` is the source for model `mode` and context-window limits; context-usage UI also requires the final streamed chat call to request `stream_options.include_usage` and receive terminal `usage.prompt_tokens`.
- Never print `LITELLM_MASTER_KEY` or other secrets in commands, logs, PR bodies, or answers; the tools already read them inside the containers.

## Constraints

- Treat the LiteLLM service as production. Restart only when needed, and say what you changed.
- Check git status before edits in any of the three repos.
- Keep config, live process, virtual-key scope, and service docs aligned — follow `workflows/add-or-remove-model.md` end to end, no partial rollouts.
- Do not commit unless the user explicitly asks.

## Success criteria

- `tools/litellm-status.sh` exits 0 (config == live == key scope).
- Every exposed `chatgpt/*` alias passes `tools/smoke-test-models.sh`.
- Service docs (`README.md`, `Architecture.md`, `ChatGPT-Models-Runbook.md`) describe the current model set.
- Any tinytinkerer code changes are verified with focused tests/typechecks.
