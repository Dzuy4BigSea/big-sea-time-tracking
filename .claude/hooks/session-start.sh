#!/bin/bash
# Installs npm deps in Claude Code cloud sessions so tsc / vitest / next build work.
# Uses `npm ci` (never rewrites package-lock.json) and skips it when the cached
# container's node_modules already matches the lockfile.
# postinstall runs `prisma generate`, which needs no database connection.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
