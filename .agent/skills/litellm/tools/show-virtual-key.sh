#!/usr/bin/env bash
# Show a LiteLLM virtual key's model scope from the litellm-db Postgres.
# An empty models array means the key is UNRESTRICTED (sees every live model).
#
# Usage: show-virtual-key.sh [ALIAS] [--models-only]
#   ALIAS          key_alias to look up (default: tinytinkerer-edge-20260606213400)
#   --models-only  print one scoped model per line (machine-readable)
# Exit:  0 found | 1 alias not found | 2 db container down / query failed
set -euo pipefail

DB_CONTAINER=litellm-db
DEFAULT_KEY_ALIAS=tinytinkerer-edge-20260606213400

ALIAS="$DEFAULT_KEY_ALIAS"
MODELS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --models-only)
      MODELS_ONLY=1
      ;;
    -h | --help)
      sed -n '2,9p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    -*)
      echo "Unknown flag: $arg (usage: show-virtual-key.sh [ALIAS] [--models-only])" >&2
      exit 2
      ;;
    *)
      ALIAS="$arg"
      ;;
  esac
done

if ! docker ps --filter "name=^${DB_CONTAINER}\$" --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: container '${DB_CONTAINER}' is not running" >&2
  exit 2
fi

run_sql() {
  # $1: extra psql flags, stdin: SQL. Container env supplies POSTGRES_USER/DB.
  docker exec -i "$DB_CONTAINER" bash -lc \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -v ON_ERROR_STOP=1 -v alias="$1" '"$1"' -f -' \
    bash "$ALIAS"
}

count="$(run_sql -At <<'SQL'
select count(*) from "LiteLLM_VerificationToken" where key_alias = :'alias';
SQL
)"
if [[ "$count" != 1 ]]; then
  echo "ERROR: key_alias '${ALIAS}' matched ${count} rows in LiteLLM_VerificationToken" >&2
  exit 1
fi

if [[ "$MODELS_ONLY" == 1 ]]; then
  run_sql -At <<'SQL'
select unnest(models) from "LiteLLM_VerificationToken" where key_alias = :'alias' order by 1;
SQL
else
  run_sql "" <<'SQL'
select key_alias, models, updated_at, updated_by
from "LiteLLM_VerificationToken"
where key_alias = :'alias';
SQL
fi
