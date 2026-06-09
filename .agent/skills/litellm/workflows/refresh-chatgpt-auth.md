# Bootstrap or refresh ChatGPT OAuth (device-code flow)

Use for: `chatgpt/*` models failing with auth-shaped errors (401/expired token)
while `openai/*` models work, or first-time setup of the ChatGPT backend.

## 1. Confirm it's auth, not config or entitlement

```bash
.agent/skills/litellm/tools/litellm-status.sh
.agent/skills/litellm/tools/smoke-test-models.sh        # defaults to all live chatgpt/*
```

- Auth problem: every `chatgpt/*` alias fails with 401-style errors; `openai/*`
  aliases are fine.
- Entitlement problem (NOT fixed by re-auth): a specific alias returns 400 with
  `...model is not supported when using Codex with a ChatGPT account.` — retire
  it via `add-or-remove-model.md` instead.

## 2. Run the device-code bootstrap (interactive)

```bash
cd ~/git/lair.nntin.xyz/projects/nntin-labs
docker compose run --rm --no-deps --entrypoint /app/.venv/bin/python3 litellm \
  -c 'from litellm.llms.chatgpt.authenticator import Authenticator; Authenticator().get_access_token(); print("ChatGPT auth stored")'
```

This prints a device-code URL — relay it to the user; it must be opened with
the ChatGPT-subscription account. Wait for `ChatGPT auth stored`.

## 3. Know where the tokens live

Volume `litellm_chatgpt_auth`, mounted at `CHATGPT_TOKEN_DIR=/var/lib/litellm/chatgpt`.
Tokens survive container recreation; no config change is needed for a refresh.
(Implementation: `litellm/llms/chatgpt/authenticator.py` in the source checkout —
it auto-refreshes via the stored `refresh_token` until that too expires.)

## 4. Restart and verify

```bash
docker compose restart litellm
.agent/skills/litellm/tools/smoke-test-models.sh
```

All live `chatgpt/*` aliases must print `OK`. If one now fails with the
"not supported when using Codex" 400, the account's entitlement changed —
that's a model-retirement job (`add-or-remove-model.md`), not an auth job.
