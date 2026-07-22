#!/usr/bin/env bash
set -euo pipefail

repo_root="${BLACKSPIRE_RELEASE_DIR:-$(git rev-parse --show-toplevel)}"
[[ -f "$repo_root/.release-complete" || -z "${BLACKSPIRE_RELEASE_DIR:-}" ]] || { echo 'production release is incomplete' >&2; exit 1; }
cd "$repo_root"
bash scripts/verify-environment.sh vps-production
printf 'BLACKSPIRE PRODUCTION MODE: state-owner=vps-production provider=%s telegram=not-auto-started test-auth=disabled\n' "${BLACKSPIRE_PROVIDER_MODE:-manual}"
exec node scripts/production-supervisor.js
