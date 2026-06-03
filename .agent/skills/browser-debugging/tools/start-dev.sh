#!/usr/bin/env bash
# Preflight + start the tinytinkerer dev servers for browser debugging.
#
# Offloads the deterministic cold-start steps that bite every fresh worktree
# (see workflows/debug-pnpm-dev.md):
#   1. deps installed + native build scripts (sharp/esbuild/workerd) run — pnpm
#      ignores those build scripts by default, so `generate:brand-assets` dies
#      with "Cannot find package 'sharp'".
#   2. ports 3111 (host) and 8787 (edge) free — a stale/orphaned `workerd` from
#      another worktree holding :8787 makes `pnpm dev` exit with
#      "Address already in use".
#
# Idempotent: safe to re-run. Starts `pnpm dev` in the background (nohup) and
# waits until BOTH servers answer, then prints their URLs. Brand-asset
# generation is skipped on the dev run itself (we generate once here) for speed.
#
# Usage: bash .agent/skills/browser-debugging/tools/start-dev.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root"
log() { printf '[start-dev] %s\n' "$*"; }

# 1. Free the dev ports. Only kill processes that are NOT this repo's own dev run
#    is hard to tell apart, so kill whatever holds them — a wedged dev server is
#    exactly what we want gone. (curl health probes also show up; ignore those.)
for port in 3111 8787; do
  pids="$(lsof -ti:"$port" 2>/dev/null | while read -r pid; do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
      curl) ;; # transient health probe, leave it
      *) echo "$pid" ;;
    esac
  done || true)"
  if [ -n "$pids" ]; then
    log "freeing port $port (killing: $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
done

# 2. Ensure deps + native build scripts are present.
if [ ! -d node_modules ]; then
  log "installing dependencies (pnpm install)"
  pnpm install
fi
# `sharp` is needed by scripts/generate-brand-assets.mjs; pnpm may have skipped
# its build script. Rebuilding is a no-op when already built.
if ! node -e "require('sharp')" >/dev/null 2>&1; then
  log "building native deps (sharp/esbuild/workerd)"
  pnpm rebuild sharp esbuild workerd >/dev/null 2>&1 || true
fi

# 3. Generate brand assets once (the dev run skips them for speed).
log "generating brand assets"
node ./scripts/generate-brand-assets.mjs >/dev/null

# 4. Start dev in the background.
log "starting pnpm dev (logs: /tmp/tinytinkerer-dev.log)"
TINYTINKERER_SKIP_BRAND_ASSET_GENERATION=1 nohup pnpm dev >/tmp/tinytinkerer-dev.log 2>&1 &

# 5. Wait for both servers.
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3111 2>/dev/null \
    && curl -sf -o /dev/null http://localhost:8787/health 2>/dev/null; then
    log "ready: host http://localhost:3111/web/  edge http://localhost:8787"
    exit 0
  fi
  sleep 2
done

log "timed out waiting for servers — check /tmp/tinytinkerer-dev.log"
exit 1
