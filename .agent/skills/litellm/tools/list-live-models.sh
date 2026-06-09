#!/usr/bin/env bash
# List the model IDs the running LiteLLM process serves, one per line, sorted.
# Reads LITELLM_MASTER_KEY inside the container; never prints it.
#
# Usage: list-live-models.sh [--prefix PREFIX]
# Exit:  0 ok | 1 container not running | 2 /v1/models request failed
set -euo pipefail

LITELLM_CONTAINER=litellm

PREFIX=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="${2:?--prefix needs a value}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,7p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (usage: list-live-models.sh [--prefix PREFIX])" >&2
      exit 2
      ;;
  esac
done

if ! docker ps --filter "name=^${LITELLM_CONTAINER}\$" --format '{{.Names}}' | grep -qx "$LITELLM_CONTAINER"; then
  echo "ERROR: container '${LITELLM_CONTAINER}' is not running" >&2
  exit 1
fi

if ! docker exec -i "$LITELLM_CONTAINER" sh -lc 'python3 - "$1"' sh "$PREFIX" <<'PY'; then
import json
import os
import sys
import urllib.request

prefix = sys.argv[1] if len(sys.argv) > 1 else ""
req = urllib.request.Request(
    "http://localhost:4000/v1/models",
    headers={"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"]},
)
with urllib.request.urlopen(req, timeout=10) as response:
    payload = json.load(response)
for model_id in sorted(model["id"] for model in payload["data"]):
    if model_id.startswith(prefix):
        print(model_id)
PY
  echo "ERROR: /v1/models request failed inside container '${LITELLM_CONTAINER}'" >&2
  exit 2
fi
