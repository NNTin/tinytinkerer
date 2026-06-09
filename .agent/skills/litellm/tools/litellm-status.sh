#!/usr/bin/env bash
# One-shot LiteLLM diagnostic: container state plus the three sources of truth
# (config.yaml desired models, live /v1/models, virtual-key scope) with a drift
# report. Run this first for any LiteLLM symptom.
#
# Usage: litellm-status.sh [ALIAS]
#   ALIAS  virtual key to check (default: tinytinkerer-edge-20260606213400)
# Exit:  0 no drift | 1 drift detected | 2 service/config unreachable
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR=~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm
ALIAS="${1:-tinytinkerer-edge-20260606213400}"

echo "== Containers =="
docker ps --filter name=litellm --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
echo

if [[ ! -f "$SERVICE_DIR/config.yaml" ]]; then
  echo "ERROR: $SERVICE_DIR/config.yaml not found" >&2
  exit 2
fi
config_models="$(grep -E '^[[:space:]]*-[[:space:]]*model_name:' "$SERVICE_DIR/config.yaml" \
  | sed -E 's/^[[:space:]]*-[[:space:]]*model_name:[[:space:]]*//' | sort)"
echo "== Desired models (config.yaml) =="
echo "$config_models"
echo

live_models="$("$TOOLS_DIR/list-live-models.sh")" || exit 2
echo "== Live models (/v1/models, running process) =="
echo "$live_models"
echo

key_models="$("$TOOLS_DIR/show-virtual-key.sh" "$ALIAS" --models-only)" || exit 2
echo "== Virtual-key scope (${ALIAS}) =="
if [[ -z "$key_models" ]]; then
  echo "(empty array = unrestricted: the key sees every live model)"
else
  echo "$key_models"
fi
echo

echo "== Drift report =="
drift=0
report() {
  # $1 label, $2 newline-separated model list (may be empty)
  if [[ -n "$2" ]]; then
    drift=1
    while IFS= read -r model; do
      echo "DRIFT: $1: $model"
    done <<<"$2"
  fi
}

report "in config.yaml but not live (restart needed?)" \
  "$(comm -23 <(echo "$config_models") <(echo "$live_models"))"
report "live but not in config.yaml (config edited without restart, or DB-managed model?)" \
  "$(comm -13 <(echo "$config_models") <(echo "$live_models"))"
if [[ -n "$key_models" ]]; then
  report "live but not in virtual key (key sync needed)" \
    "$(comm -23 <(echo "$live_models") <(echo "$key_models"))"
  report "in virtual key but not live (stale scope)" \
    "$(comm -13 <(echo "$live_models") <(echo "$key_models"))"
fi

if [[ "$drift" == 0 ]]; then
  count="$(wc -l <<<"$live_models")"
  if [[ -z "$key_models" ]]; then
    echo "OK: config == live (${count} models); virtual key unrestricted"
  else
    echo "OK: config == live == virtual key (${count} models)"
  fi
fi
exit "$drift"
