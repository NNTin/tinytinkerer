#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
pnpm pin:dependencies
pnpm install --lockfile-only
