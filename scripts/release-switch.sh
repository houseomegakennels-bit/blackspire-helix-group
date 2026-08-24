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
# Record what is being deployed BEFORE it becomes current, so a release can never be live
# without the deployment record its own startup identity check requires.
"$(dirname "$0")/with-node.sh" "$(dirname "$0")/write-deployment-record.js" "$target" >/dev/null
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
printf '%s\n' "$target"
