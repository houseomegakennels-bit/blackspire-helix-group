#!/usr/bin/env bash
set -euo pipefail

commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-preflight.sh <full-commit-sha>' >&2; exit 2; }
root="${root%/}"
[[ -n "$root" ]] || root=/
source "$(dirname "$0")/release-tree-validator.sh"
release_validate_completed_release "$root" "$commit"
