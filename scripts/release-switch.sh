#!/usr/bin/env bash
set -euo pipefail
commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-switch.sh <full-commit-sha>' >&2; exit 2; }
root="${root%/}"
[[ -n "$root" ]] || root=/
source "$(dirname "$0")/release-tree-validator.sh"
target="$root/releases/$commit"
release_validate_completed_release "$root" "$commit"
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
printf '%s\n' "$target"
