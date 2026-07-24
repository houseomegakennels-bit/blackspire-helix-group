#!/usr/bin/env bash
set -euo pipefail

repo_root="${BLACKSPIRE_RELEASE_DIR:-$(git rev-parse --show-toplevel)}"
[[ -f "$repo_root/.release-complete" || -z "${BLACKSPIRE_RELEASE_DIR:-}" ]] || { echo 'production release is incomplete' >&2; exit 1; }
cd "$repo_root"
bash scripts/verify-environment.sh vps-production
# shellcheck source=scripts/lib/node-bin.sh
. scripts/lib/node-bin.sh
node_bin="$(blackspire_resolve_node)" || { echo 'production requires Node 22.5 or newer' >&2; exit 1; }
printf 'BLACKSPIRE PRODUCTION MODE: state-owner=vps-production provider=%s telegram=not-auto-started test-auth=disabled\n' "${BLACKSPIRE_PROVIDER_MODE:-manual}"
exec "$node_bin" scripts/production-supervisor.js
