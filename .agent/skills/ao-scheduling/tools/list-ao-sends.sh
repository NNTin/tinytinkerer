#!/usr/bin/env bash
# List one-time `ao send` jobs created by schedule-ao-send.sh. Reads the
# current user's `at` queue and prints the job id, fire time, owner, queue,
# destination AO session, message, and exact queued command.
#
# Usage:
#   list-ao-sends.sh [job-id]
#
# With no job id, lists every recognized AO send in the queue. With a job id,
# prints only that job and fails if it is missing or is not a recognized
# schedule-ao-send.sh job.
#
# Exit: 0 listed (including an empty queue) | 1 usage | 2 at unavailable
#       | 3 requested job missing/unrecognized or inspection failed
set -euo pipefail

readonly TIME_FORMAT='%Y-%m-%dT%H:%M:%S%z'

log() { printf '[list-ao-sends] %s\n' "$*"; }
err() { printf '[list-ao-sends] %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
Usage:
  list-ao-sends.sh [job-id]

  job-id  optional numeric `at` job id to inspect

Exit: 0 listed (including an empty queue) | 1 usage | 2 at unavailable
      | 3 requested job missing/unrecognized or inspection failed
USAGE
}

check_commands() {
  local command_name
  for command_name in at atq; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      err "ERROR: '$command_name' is not installed."
      err "Abort: run this tool in the Agent-Orchestrator container."
      return 2
    fi
  done
}

# Parse one single-quoted token emitted by schedule-ao-send.sh's sq() helper.
# Results are returned through PARSED_VALUE and PARSED_REST. This deliberately
# implements only that narrow grammar instead of evaluating untrusted at jobs.
parse_single_quoted_token() {
  local input="$1"
  local value=''
  local char
  local i=1
  local length="${#input}"

  PARSED_VALUE=''
  PARSED_REST=''
  [[ "${input:0:1}" == "'" ]] || return 1

  while ((i < length)); do
    char="${input:i:1}"
    if [[ "$char" != "'" ]]; then
      value+="$char"
      ((i += 1))
      continue
    fi

    # A literal apostrophe is emitted as: '\'' (close, escape, reopen).
    if [[ "${input:i:4}" == "'\\''" ]]; then
      value+="'"
      ((i += 4))
      continue
    fi

    PARSED_VALUE="$value"
    PARSED_REST="${input:i+1}"
    return 0
  done

  return 1
}

# Recognize only the exact command grammar emitted by schedule-ao-send.sh:
#   /path/to/ao send '<session>' '<message>' --no-wait
# The message may contain apostrophes or newlines. No queued content is eval'd.
parse_ao_send() {
  local job_content="$1"
  local command_pattern
  local command_prefix
  local args
  local session
  local message
  local rest

  command_pattern=$'(^|\n)(([^[:space:]]*/)?ao)[[:space:]]+send[[:space:]]+'
  [[ "$job_content" =~ $command_pattern ]] || return 1

  command_prefix="${BASH_REMATCH[0]}"
  args="${job_content#*"${BASH_REMATCH[0]}"}"

  parse_single_quoted_token "$args" || return 1
  session="$PARSED_VALUE"
  rest="$PARSED_REST"
  [[ "$rest" == ' '* ]] || return 1
  rest="${rest# }"

  parse_single_quoted_token "$rest" || return 1
  message="$PARSED_VALUE"
  rest="$PARSED_REST"
  [[ "$rest" =~ ^[[:space:]]+--no-wait[[:space:]]*$ ]] || return 1

  AO_SESSION="$session"
  AO_MESSAGE="$message"
  AO_COMMAND="${command_prefix#$'\n'}$args"
}

print_multiline_field() {
  local label="$1"
  local value="$2"
  local padding='             '
  local first=1
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$first" == 1 ]]; then
      printf '  %-8s: %s\n' "$label" "$line"
      first=0
    else
      printf '%s%s\n' "$padding" "$line"
    fi
  done < <(printf '%s' "$value")

  if [[ "$first" == 1 ]]; then
    printf '  %-8s: \n' "$label"
  fi
}

print_job() {
  local job_id="$1"
  local scheduled_at="$2"
  local queue="$3"
  local owner="$4"
  local job_content

  if ! job_content="$(at -c "$job_id" 2>/dev/null)"; then
    return 2
  fi
  parse_ao_send "$job_content" || return 1

  printf '== AO schedule #%s ==\n' "$job_id"
  printf '  %-8s: %s\n' 'when' "$scheduled_at"
  printf '  %-8s: %s\n' 'owner' "$owner"
  printf '  %-8s: %s\n' 'queue' "$queue"
  print_multiline_field 'session' "$AO_SESSION"
  print_multiline_field 'message' "$AO_MESSAGE"
  print_multiline_field 'command' "$AO_COMMAND"
}

target_job=''
case "$#" in
  0) ;;
  1)
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      *)
        target_job="$1"
        ;;
    esac
    ;;
  *)
    err 'ERROR: expected zero or one job id.'
    usage >&2
    exit 1
    ;;
esac

if [[ -n "$target_job" && ! "$target_job" =~ ^[1-9][0-9]*$ ]]; then
  err "ERROR: job id must be a positive integer: $target_job"
  usage >&2
  exit 1
fi

check_commands || exit $?

if ! queue_output="$(LC_ALL=C atq -o "$TIME_FORMAT" 2>&1)"; then
  err "ERROR: unable to read the current user's at queue:"
  printf '%s\n' "$queue_output" | sed 's/^/  /' >&2
  exit 2
fi

found_target=0
listed=0
inspection_failed=0
while read -r job_id scheduled_at queue owner _rest; do
  [[ -n "${job_id:-}" ]] || continue
  if [[ -n "$target_job" && "$job_id" != "$target_job" ]]; then
    continue
  fi

  found_target=1
  set +e
  print_job "$job_id" "$scheduled_at" "$queue" "$owner"
  print_rc=$?
  set -e
  case "$print_rc" in
    0)
      ((listed += 1))
      ;;
    1)
      if [[ -n "$target_job" ]]; then
        err "ERROR: at job #$job_id is not a recognized AO send schedule."
        exit 3
      fi
      ;;
    *)
      err "ERROR: unable to inspect at job #$job_id; it may have already fired."
      inspection_failed=1
      ;;
  esac
done <<<"$queue_output"

if [[ -n "$target_job" && "$found_target" == 0 ]]; then
  err "ERROR: at job #$target_job does not exist in the current user's queue."
  exit 3
fi
if [[ "$inspection_failed" == 1 ]]; then
  exit 3
fi
if [[ "$listed" == 0 && -z "$target_job" ]]; then
  log 'No queued AO send schedules.'
fi
