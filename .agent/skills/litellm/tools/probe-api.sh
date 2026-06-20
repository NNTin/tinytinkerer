#!/usr/bin/env bash
# Probe LiteLLM's local OpenAPI document plus model metadata endpoints. Runs
# inside the litellm container so the master key is read from container env and
# never appears in shell arguments or output.
#
# Usage: probe-api.sh [--public-base URL] [--no-public]
# Exit:  0 ok | 1 public route missing/failing | 2 container/internal API failing
set -euo pipefail

LITELLM_CONTAINER=litellm
PUBLIC_BASE="https://litellm.labs.lair.nntin.xyz"
CHECK_PUBLIC=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-base)
      PUBLIC_BASE="${2:?--public-base needs a URL}"
      shift 2
      ;;
    --no-public)
      CHECK_PUBLIC=0
      shift
      ;;
    -h | --help)
      sed -n '2,8p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (usage: probe-api.sh [--public-base URL] [--no-public])" >&2
      exit 2
      ;;
  esac
done

if ! docker ps --filter "name=^${LITELLM_CONTAINER}\$" --format '{{.Names}}' | grep -qx "$LITELLM_CONTAINER"; then
  echo "ERROR: container '${LITELLM_CONTAINER}' is not running" >&2
  exit 2
fi

docker exec -i "$LITELLM_CONTAINER" python3 - "$PUBLIC_BASE" "$CHECK_PUBLIC" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request

INTERNAL_BASE = "http://localhost:4000"
PUBLIC_BASE = sys.argv[1].rstrip("/")
CHECK_PUBLIC = sys.argv[2] == "1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)


def request(url):
    req = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"]},
    )
    try:
        with opener.open(req, timeout=15) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def print_status(label, status, headers):
    location = headers.get("Location")
    suffix = f" location={location}" if location else ""
    print(f"{label}: HTTP {status}{suffix}")


exit_code = 0

status, headers, raw = request(INTERNAL_BASE + "/openapi.json")
print("== Internal OpenAPI ==")
print_status("/openapi.json", status, headers)
if status == 200:
    payload = json.loads(raw)
    paths = set(payload.get("paths", {}))
    for path in ["/v1/models", "/model/info", "/v1/model/info", "/v1/chat/completions"]:
        print(f"{path}: {'yes' if path in paths else 'no'}")
else:
    exit_code = max(exit_code, 2)
print()

status, headers, raw = request(INTERNAL_BASE + "/model/info")
print("== Internal /model/info ==")
print_status("/model/info", status, headers)
if status == 200:
    payload = json.loads(raw)
    rows = []
    for entry in payload.get("data", []):
        info = entry.get("model_info") or {}
        rows.append(
            (
                entry.get("model_name", ""),
                info.get("mode", ""),
                info.get("max_input_tokens", ""),
                info.get("max_output_tokens", ""),
                info.get("max_tokens", ""),
            )
        )
    print("model\tmode\tmax_input\tmax_output\tmax_tokens")
    for row in sorted(rows):
        print("\t".join(str(value) for value in row))
else:
    exit_code = max(exit_code, 2)
print()

if CHECK_PUBLIC:
    status, headers, _raw = request(PUBLIC_BASE + "/model/info")
    print("== Public /model/info ==")
    print_status(PUBLIC_BASE + "/model/info", status, headers)
    if status != 200:
        exit_code = max(exit_code, 1)

sys.exit(exit_code)
PY
