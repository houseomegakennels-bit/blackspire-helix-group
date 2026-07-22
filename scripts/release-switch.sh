#!/usr/bin/env bash
set -euo pipefail
commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-switch.sh <full-commit-sha>' >&2; exit 2; }
target="$root/releases/$commit"
[[ -d "$target" && ! -L "$target" ]] || { echo 'release destination is missing or unsafe' >&2; exit 1; }
[[ -f "$target/.release-complete" && ! -L "$target/.release-complete" ]] || { echo 'release is missing completion marker' >&2; exit 1; }
ln -sfn "$target" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
printf '%s\n' "$target"
