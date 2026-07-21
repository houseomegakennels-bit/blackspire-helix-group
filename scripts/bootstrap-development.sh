#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
profile="${1:-development}"

if [[ -s .node-version ]] && command -v nvm >/dev/null 2>&1; then
  nvm install "$(<.node-version)"
  nvm use "$(<.node-version)"
fi

BLACKSPIRE_ENVIRONMENT="$profile" BLACKSPIRE_PROVIDER_MODE="${BLACKSPIRE_PROVIDER_MODE:-manual}" bash scripts/verify-environment.sh "$profile"
npm ci --ignore-scripts
if [[ "${BLACKSPIRE_BOOTSTRAP_FRONTEND:-false}" == "true" ]]; then npm --prefix frontend ci --ignore-scripts; fi
chmod +x scripts/*.sh
printf 'BLACKSPIRE DEVELOPMENT READY: profile=%s credentials=not-loaded production-state=not-mounted\n' "$profile"
