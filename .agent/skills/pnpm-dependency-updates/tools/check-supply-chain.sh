#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
pnpm check:exact-dependencies
pnpm check:install-scripts
pnpm audit --audit-level=moderate
pnpm check:skill-readme
