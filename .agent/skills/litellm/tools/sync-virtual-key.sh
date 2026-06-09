#!/usr/bin/env bash
# Sync a LiteLLM virtual key's model scope to the live /v1/models list.
# Dry-run by default: prints the diff and the exact UPDATE it would execute.
# Run this AFTER restart + smoke test (see workflows/add-or-remove-model.md),
# so live == config.yaml and the key never scopes to an unserved model.
#
# Usage: sync-virtual-key.sh [ALIAS] [--apply] [--allow-empty]
#   ALIAS          key_alias to update (default: tinytinkerer-edge-20260606213400)
#   --apply        execute the UPDATE (default is dry run)
#   --allow-empty  permit an empty target set (empty array = UNRESTRICTED key)
# Exit:  0 applied or already in sync | 1 dry run with pending changes | 2 error
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR=~/git/lair.nntin.xyz/projects/nntin-labs/services/litellm
DB_CONTAINER=litellm-db

ALIAS=tinytinkerer-edge-20260606213400
APPLY=0
ALLOW_EMPTY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --allow-empty) ALLOW_EMPTY=1 ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    -*)
      echo "Unknown flag: $arg (usage: sync-virtual-key.sh [ALIAS] [--apply] [--allow-empty])" >&2
      exit 2
      ;;
    *) ALIAS="$arg" ;;
  esac
done

target="$("$TOOLS_DIR/list-live-models.sh")" || exit 2
current="$("$TOOLS_DIR/show-virtual-key.sh" "$ALIAS" --models-only)" || exit 2

config_models="$(grep -E '^[[:space:]]*-[[:space:]]*model_name:' "$SERVICE_DIR/config.yaml" \
  | sed -E 's/^[[:space:]]*-[[:space:]]*model_name:[[:space:]]*//' | sort)"
if [[ "$config_models" != "$target" ]]; then
  echo "WARNING: config.yaml and live /v1/models disagree — the target below is the LIVE set." >&2
  echo "WARNING: if config.yaml is the intent, restart litellm first (docker compose restart litellm)." >&2
fi

if [[ -z "$target" && "$ALLOW_EMPTY" == 0 ]]; then
  echo "ERROR: live model list is empty; refusing to write ARRAY[]::text[] (= unrestricted key)." >&2
  echo "ERROR: pass --allow-empty if an unrestricted key is really the intent." >&2
  exit 2
fi

echo "== Current scope (${ALIAS}) =="
if [[ -z "$current" ]]; then echo "(empty = unrestricted)"; else echo "$current"; fi
echo
echo "== Target scope (live /v1/models) =="
if [[ -z "$target" ]]; then echo "(empty = unrestricted)"; else echo "$target"; fi
echo

if [[ "$current" == "$target" ]]; then
  echo "Already in sync — nothing to do."
  exit 0
fi

echo "== Diff =="
comm -23 <(echo "$current" | sed '/^$/d') <(echo "$target" | sed '/^$/d') | sed 's/^/  - remove /'
comm -13 <(echo "$current" | sed '/^$/d') <(echo "$target" | sed '/^$/d') | sed 's/^/  + add    /'
echo

if [[ -z "$target" ]]; then
  array_literal="ARRAY[]::text[]"
else
  parts=""
  while IFS= read -r model; do
    escaped="${model//\'/\'\'}"
    parts+="${parts:+,}'${escaped}'"
  done <<<"$target"
  array_literal="ARRAY[${parts}]::text[]"
fi
alias_escaped="${ALIAS//\'/\'\'}"
sql="update \"LiteLLM_VerificationToken\" set models = ${array_literal}, updated_at = now(), updated_by = 'sync-virtual-key.sh' where key_alias = '${alias_escaped}';"

echo "== SQL =="
echo "$sql"
echo

if [[ "$APPLY" == 0 ]]; then
  echo "Dry run — re-run with --apply to execute."
  exit 1
fi

printf '%s\n' "$sql" | docker exec -i "$DB_CONTAINER" bash -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off -f -'
echo
echo "== Post-update scope =="
"$TOOLS_DIR/show-virtual-key.sh" "$ALIAS"
