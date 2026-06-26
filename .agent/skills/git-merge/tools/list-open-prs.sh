#!/usr/bin/env bash
# Triage open PRs before merging — the read-only companion to merge-and-push.sh
# (see ../SKILL.md). Folds the multi-command dance an agent runs by hand into one
# deterministic, token-cheap table: one line per open PR with everything needed
# to decide what to merge next. Per PR it answers:
#   - MERGE  fast-forward-able onto the base (ff) or needs a merge commit (merge)?
#            `git merge-base --is-ancestor <base> origin/<head>`. `?` = head ref
#            not fetched locally (e.g. a fork) so FF can't be determined.
#   - STATE  GitHub's mergeStateStatus (CLEAN / BLOCKED / BEHIND / DIRTY / ...).
#   - CHECKS rollup of `gh pr checks`: `pass` | `N fail` | `N pending` | `none`.
#
# `gh` is used READ-ONLY here (listing only) — that is fine. The skill's no-gh
# rule applies ONLY to landing commits: never merge/push through gh.
#
# Usage: bash .agent/skills/git-merge/tools/list-open-prs.sh [base-ref]
#   [base-ref]  branch the PRs would merge into, for FF eligibility.
#               Default = the current branch (develop in normal use).
#
# Runs `git fetch origin --prune` first so FF / merge-base is accurate.
#
# Exit: 0 ok (incl. zero open PRs) | 1 usage | 2 gh missing/unauthenticated
#       | 3 not a git repo / fetch failed
set -euo pipefail

log() { printf '[list-open-prs] %s\n' "$*" >&2; }

# --- args -------------------------------------------------------------------
base_arg=""
for arg in "$@"; do
  case "$arg" in
    -h | --help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) log "error: unknown flag '$arg'"; exit 1 ;;
    *)
      if [ -n "$base_arg" ]; then
        log "error: more than one base ref given ('$base_arg' and '$arg')"
        exit 1
      fi
      base_arg="$arg"
      ;;
  esac
done

# --- preconditions ----------------------------------------------------------
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  log "error: not inside a git repository."
  exit 3
fi
cd "$(git rev-parse --show-toplevel)"

if ! command -v gh >/dev/null 2>&1; then
  log "error: 'gh' not found on PATH (needed to list PRs). Install GitHub CLI."
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  log "error: gh is not authenticated — run 'gh auth login' (or set GH_TOKEN)."
  exit 2
fi

base="${base_arg:-$(git rev-parse --abbrev-ref HEAD)}"
# Prefer the remote-tracking tip for the base so FF reflects what is published.
if git rev-parse --verify --quiet "origin/$base^{commit}" >/dev/null; then
  base_ref="origin/$base"
else
  base_ref="$base"
fi

# --- fetch so merge-base / FF eligibility is accurate -----------------------
if ! git fetch origin --prune >/dev/null 2>&1; then
  log "error: 'git fetch origin --prune' failed — cannot compute FF accurately."
  exit 3
fi

# --- list open PRs ----------------------------------------------------------
prs="$(gh pr list --state open \
  --json number,title,headRefName,mergeStateStatus,mergeable \
  --jq '.[] | [.number, .headRefName, .mergeStateStatus, .title] | @tsv')"

if [ -z "$prs" ]; then
  log "no open PRs."
  exit 0
fi

# --- build one compact row per PR -------------------------------------------
checks_rollup() {
  # Rollup of `gh pr checks <n>` buckets → terse cell. fail wins over pending.
  local n="$1" buckets fail pending
  buckets="$(gh pr checks "$n" --json bucket --jq '.[].bucket' 2>/dev/null || true)"
  if [ -z "$buckets" ]; then
    printf 'none'
    return
  fi
  fail="$(printf '%s\n' "$buckets" | grep -cE '^(fail|cancel)$' || true)"
  pending="$(printf '%s\n' "$buckets" | grep -cE '^pending$' || true)"
  if [ "$fail" -gt 0 ]; then
    printf '%s fail' "$fail"
  elif [ "$pending" -gt 0 ]; then
    printf '%s pending' "$pending"
  else
    printf 'pass'
  fi
}

rows="PR#	MERGE	STATE	CHECKS	BRANCH	TITLE"
while IFS=$'\t' read -r number head state title; do
  [ -n "$number" ] || continue
  if git rev-parse --verify --quiet "origin/$head^{commit}" >/dev/null; then
    if git merge-base --is-ancestor "$base_ref" "origin/$head" 2>/dev/null; then
      merge="ff"
    else
      merge="merge"
    fi
  else
    merge="?"
  fi
  checks="$(checks_rollup "$number")"
  # Keep titles token-cheap.
  if [ "${#title}" -gt 50 ]; then
    title="${title:0:49}…"
  fi
  rows+=$'\n'"$number	$merge	$state	$checks	$head	$title"
done <<< "$prs"

log "base: $base_ref"
# Align into a compact table without depending on `column` (often absent): pad
# every column but the last (TITLE) to its max width, two-space gutter.
printf '%s\n' "$rows" | awk -F'\t' '
  { for (i = 1; i <= NF; i++) { cell[NR, i] = $i; if (length($i) > w[i]) w[i] = length($i) }
    if (NF > nf) nf = NF; rows = NR }
  END { for (r = 1; r <= rows; r++) { line = ""
          for (i = 1; i <= nf; i++) { s = cell[r, i]
            if (i < nf) s = sprintf("%-*s", w[i], s); line = line (i > 1 ? "  " : "") s }
          print line } }'
