#!/usr/bin/env bash
# Schedule a ONE-TIME future `ao send <session> "<message>"` with the Unix `at`
# command. Dry-run by default: prints the exact job it would queue and the
# resolved time spec, but schedules nothing until you pass --apply. This is the
# deterministic spine of the ao-scheduling skill (see ../SKILL.md) — it offloads
# the easy-to-botch parts: verifying the `at` subsystem is actually usable and
# safely quoting the session/message into the queued job.
#
# It runs where `at` and `ao` coexist — the `ao` Agent-Orchestrator container
# (atd is started by that service's entrypoint). It is NOT for recurring jobs;
# `at` fires each job exactly once.
#
# Usage:
#   schedule-ao-send.sh <session> <at-time-spec> <message> [--apply]
#
#   <session>       AO session to deliver to, e.g. tin-orchestrator
#   <at-time-spec>  any spec `at` understands, e.g. "now + 2 hours",
#                   "14:30", "2026-06-24 09:00", "tomorrow"
#   <message>       the message text passed to `ao send`
#   --apply         actually queue the job (default is a dry run)
#
# Exit: 0 ok (or dry run printed) | 1 usage | 2 at/atd unavailable
#       | 3 scheduling failed
set -euo pipefail

log() { printf '[schedule-ao-send] %s\n' "$*"; }
err() { printf '[schedule-ao-send] %s\n' "$*" >&2; }

# Single-quote a string for safe embedding in the queued shell job.
sq() { printf "'%s'" "${1//\'/\'\\\'\'}"; }

usage() {
  cat <<'USAGE'
Usage:
  schedule-ao-send.sh <session> <at-time-spec> <message> [--apply]

  <session>       AO session to deliver to, e.g. tin-orchestrator
  <at-time-spec>  any spec `at` understands, e.g. "now + 2 hours",
                  "14:30", "2026-06-24 09:00", "tomorrow"
  <message>       the message text passed to `ao send`
  --apply         actually queue the job (default is a dry run)

Exit: 0 ok (or dry run printed) | 1 usage | 2 at/atd unavailable
      | 3 scheduling failed
USAGE
}

# --- verify the `at` subsystem is usable (acceptance: fail CLEARLY if not) ---
check_at() {
  local ok=1
  if ! command -v at >/dev/null 2>&1; then
    err "ERROR: 'at' is not installed."
    ok=0
  fi
  if ! command -v atq >/dev/null 2>&1; then
    err "ERROR: 'atq' is not installed."
    ok=0
  fi
  if [[ "$ok" == 0 ]]; then
    err "Abort: this agent does not have the rights to install or configure 'at'."
    err "Ask an operator to rebuild/restart the 'ao' service so the image ships"
    err "'at' and its entrypoint starts atd (lair repo: services/ao/)."
    return 2
  fi
  # `atq` reads the spool as the current user; a non-zero exit means this user
  # is not permitted to use `at` (see /etc/at.allow, /etc/at.deny).
  if ! atq >/dev/null 2>&1; then
    err "ERROR: 'atq' failed — this user is not permitted to use 'at'."
    err "Abort: this agent does not have the rights to edit /etc/at.allow."
    err "Ask an operator to rebuild/restart the 'ao' service; its entrypoint"
    err "must permit the 'ao' user to use 'at'."
    return 2
  fi
  # atd running is required for a queued job to FIRE (not just sit in the queue).
  if command -v pgrep >/dev/null 2>&1 && ! pgrep -x atd >/dev/null 2>&1; then
    err "ERROR: atd does not appear to be running — jobs will queue but not fire."
    err "Abort: this agent does not have the rights to start or configure atd."
    err "Ask an operator to rebuild/restart the 'ao' service so its entrypoint starts atd."
    return 2
  fi
  return 0
}

# --- parse args ---
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

if [[ "${#positional[@]}" -ne 3 ]]; then
  err "ERROR: expected exactly 3 arguments (session, time spec, message)."
  usage >&2
  exit 1
fi
session="${positional[0]}"
timespec="${positional[1]}"
message="${positional[2]}"

# Prerequisites must pass before we describe or schedule anything.
check_at || exit $?

ao_bin="$(command -v ao || echo ao)"
job_line="$(printf '%s send %s %s' "$ao_bin" "$(sq "$session")" "$(sq "$message")")"

echo "== Scheduled job =="
echo "  session : $session"
echo "  when    : $timespec   (parsed by 'at')"
echo "  command : $job_line"
echo

if [[ "$APPLY" == 0 ]]; then
  log "Dry run — nothing scheduled. Re-run with --apply once the session, time,"
  log "and message are confirmed."
  exit 0
fi

# Record existing job ids so we can identify the one we just added.
before="$(atq | awk '{print $1}' | sort)"

# `at` lexes the time spec from its argv words, so the spec is passed UNQUOTED
# on purpose (e.g. now + 2 hours -> three words). at prints "job N at <date>"
# on stderr; capture both streams to surface failures and the job id.
set +e
# shellcheck disable=SC2086
at_output="$(printf '%s\n' "$job_line" | at $timespec 2>&1)"
at_rc=$?
set -e
if [[ "$at_rc" -ne 0 ]]; then
  err "ERROR: 'at' rejected the schedule (rc=$at_rc):"
  printf '%s\n' "$at_output" | sed 's/^/  /' >&2
  exit 3
fi
printf '%s\n' "$at_output" | sed 's/^/[at] /'
echo

after="$(atq | awk '{print $1}' | sort)"
new_job="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -n1)"

echo "== atq =="
atq
echo
if [[ -n "$new_job" ]]; then
  log "Queued job #$new_job."
else
  log "Scheduled."
fi
