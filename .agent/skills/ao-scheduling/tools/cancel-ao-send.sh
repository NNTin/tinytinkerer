#!/usr/bin/env bash
# Cancel one recognized AO send in the current user's `at` queue. Dry-run by
# default: prints full job details and the exact atrm command, but changes
# nothing until --apply is supplied.
#
# Usage:
#   cancel-ao-send.sh <job-id> [--apply]
#
# Exit: 0 previewed/canceled | 1 usage | 2 at/atrm unavailable
#       | 3 job missing/unrecognized | 4 cancellation/verification failed
set -euo pipefail

log() { printf '[cancel-ao-send] %s\n' "$*"; }
err() { printf '[cancel-ao-send] %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
Usage:
  cancel-ao-send.sh <job-id> [--apply]

  job-id   numeric `at` job id to cancel
  --apply  actually cancel the job (default is a dry run)

Exit: 0 previewed/canceled | 1 usage | 2 at/atrm unavailable
      | 3 job missing/unrecognized | 4 cancellation/verification failed
USAGE
}

APPLY=0
positional=()
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    --*)
      err "Unknown flag: $arg"
      usage >&2
      exit 1
      ;;
    *) positional+=("$arg") ;;
  esac
done

if [[ "${#positional[@]}" -ne 1 ]]; then
  err 'ERROR: expected exactly one job id.'
  usage >&2
  exit 1
fi
job_id="${positional[0]}"
if [[ ! "$job_id" =~ ^[1-9][0-9]*$ ]]; then
  err "ERROR: job id must be a positive integer: $job_id"
  usage >&2
  exit 1
fi

for command_name in at atq atrm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    err "ERROR: '$command_name' is not installed."
    err "Abort: run this tool in the Agent-Orchestrator container."
    exit 2
  fi
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
list_tool="$script_dir/list-ao-sends.sh"
if [[ ! -f "$list_tool" ]]; then
  err "ERROR: listing tool not found: $list_tool"
  exit 2
fi

set +e
job_details="$(bash "$list_tool" "$job_id" 2>&1)"
list_rc=$?
set -e
if [[ "$list_rc" -ne 0 ]]; then
  printf '%s\n' "$job_details" >&2
  if [[ "$list_rc" == 2 ]]; then
    exit 2
  fi
  exit 3
fi
printf '%s\n\n' "$job_details"

echo '== Cancellation =='
printf '  job id  : %s\n' "$job_id"
printf '  command : atrm %s\n\n' "$job_id"

if [[ "$APPLY" == 0 ]]; then
  log 'Dry run — nothing canceled. Re-run with --apply after confirming the'
  log 'job id, time, session, and message.'
  exit 0
fi

set +e
atrm_output="$(atrm "$job_id" 2>&1)"
atrm_rc=$?
set -e
if [[ "$atrm_rc" -ne 0 ]]; then
  err "ERROR: atrm failed for job #$job_id (rc=$atrm_rc):"
  printf '%s\n' "$atrm_output" | sed 's/^/  /' >&2
  exit 4
fi

if ! queue_output="$(LC_ALL=C atq -o '%Y-%m-%dT%H:%M:%S%z' 2>&1)"; then
  err 'ERROR: cancellation ran, but the at queue could not be read for verification:'
  printf '%s\n' "$queue_output" | sed 's/^/  /' >&2
  exit 4
fi
if awk -v id="$job_id" '$1 == id { found = 1 } END { exit !found }' <<<"$queue_output"; then
  err "ERROR: at job #$job_id is still queued after atrm."
  exit 4
fi

log "Canceled job #$job_id and verified its removal."
