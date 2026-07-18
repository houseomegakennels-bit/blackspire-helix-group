#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
bash scripts/verify-environment.sh vps-production
node scripts/migrate.js
node apps/api/server.js & api_pid=$!
node apps/worker/worker.js & worker_pid=$!
cleanup() { kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true; wait "$api_pid" "$worker_pid" 2>/dev/null || true; }
trap cleanup INT TERM EXIT
printf 'BLACKSPIRE PRODUCTION MODE: state-owner=vps-production provider=%s telegram=not-auto-started test-auth=disabled\n' "${BLACKSPIRE_PROVIDER_MODE:-manual}"
wait -n "$api_pid" "$worker_pid"
