#!/usr/bin/env bash
set -euo pipefail
commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-rollback.sh <known-good-full-commit-sha>' >&2; exit 2; }
"$(dirname "$0")/release-switch.sh" "$commit"
