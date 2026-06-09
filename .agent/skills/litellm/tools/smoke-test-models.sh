#!/usr/bin/env bash
# Smoke-test model aliases with a minimal chat completion through the live
# LiteLLM process. Listed in /v1/models does NOT mean callable — run this
# before exposing any chatgpt/* alias. Prints OK/ERR per model with the
# upstream error detail (truncated); never prints keys.
#
# Usage: smoke-test-models.sh [MODEL ...]   (default: all live chatgpt/* models)
# Exit:  0 all OK | 1 any ERR | 2 nothing to test / container down
set -euo pipefail

LITELLM_CONTAINER=litellm

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,9p' "${BASH_SOURCE[0]}"
  exit 0
fi

if ! docker ps --filter "name=^${LITELLM_CONTAINER}\$" --format '{{.Names}}' | grep -qx "$LITELLM_CONTAINER"; then
  echo "ERROR: container '${LITELLM_CONTAINER}' is not running" >&2
  exit 2
fi

docker exec -i "$LITELLM_CONTAINER" sh -lc 'python3 - "$@"' sh "$@" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:4000"


def auth_headers():
    return {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"]}


models = sys.argv[1:]
if not models:
    req = urllib.request.Request(BASE + "/v1/models", headers=auth_headers())
    with urllib.request.urlopen(req, timeout=10) as response:
        models = sorted(
            model["id"]
            for model in json.load(response)["data"]
            if model["id"].startswith("chatgpt/")
        )
if not models:
    print("No models to test (no live chatgpt/* aliases).", file=sys.stderr)
    sys.exit(2)

failed = False
for model in models:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
        "stream": False,
        "max_tokens": 5,
    }).encode()
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=payload,
        headers={**auth_headers(), "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            print("OK", model, response.status)
    except urllib.error.HTTPError as error:
        print("ERR", model, error.code, error.read().decode(errors="replace")[:500])
        failed = True
    except urllib.error.URLError as error:
        print("ERR", model, "-", str(error)[:200])
        failed = True

sys.exit(1 if failed else 0)
PY
