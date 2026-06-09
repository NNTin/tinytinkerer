# Add or remove a LiteLLM model alias (end-to-end rollout)

Use for: exposing a new model to tinytinkerer, or retiring an alias (e.g. an
unsupported `chatgpt/*` model). A partial rollout is worse than none — config,
live process, virtual key, and service docs must move together.

`SERVICE_DIR=~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm`

## 1. Preflight

```bash
git -C ~/git/lair.nntin.xyz/projects/nntin-labs status --short --branch
.agent/skills/litellm/tools/litellm-status.sh
```

Don't trample unrelated changes in the lair repo; capture the before-state.

## 2. Edit `$SERVICE_DIR/config.yaml`

Add or remove the `model_list` entry. For `chatgpt/*` aliases copy the existing
`chatgpt/gpt-5.4` entry shape, including `model_info.mode: responses`.
GitHub-backed `openai/*` aliases use `api_base: https://models.github.ai/inference`
and `api_key: os.environ/GITHUB_MODELS_TOKEN`.

## 3. Restart the process

```bash
cd ~/git/lair.nntin.xyz/projects/nntin-labs
docker compose restart litellm
```

The config is bind-mounted but read at startup only; `docker compose up -d`
may no-op on an unchanged container — use `restart`.

## 4. Verify the live list picked up the change

```bash
.agent/skills/litellm/tools/list-live-models.sh
```

## 5. Gate for additions: smoke test

```bash
.agent/skills/litellm/tools/smoke-test-models.sh <new-model>
```

**Listed ≠ callable.** A `chatgpt/*` alias can appear in `/v1/models` and still
be rejected upstream (`The '<model>' model is not supported when using Codex
with a ChatGPT account.`). On `ERR`, stop: remove the alias from `config.yaml`
again and restart — do not proceed to the key sync.

## 6. Sync the virtual-key scope

```bash
.agent/skills/litellm/tools/sync-virtual-key.sh            # dry run, review diff
.agent/skills/litellm/tools/sync-virtual-key.sh --apply
```

## 7. Update the service docs together

All three in `$SERVICE_DIR`: `README.md`, `Architecture.md`,
`ChatGPT-Models-Runbook.md` (model inventory / mapping sections).

## 8. Verify the end state

- `.agent/skills/litellm/tools/litellm-status.sh` exits 0.
- tinytinkerer side: the edge caches model lists for 5 minutes and the browser
  caches in memory — wait or use the Settings refresh before judging.

## 9. Close out

Do not commit either repo unless asked. Report exactly what changed: config
entry, restart, smoke result, key scope diff, docs touched.
