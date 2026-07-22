#!/usr/bin/env bash
set -euo pipefail
commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
repo="${BLACKSPIRE_SOURCE_ROOT:-$(git rev-parse --show-toplevel)}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-create.sh <full-commit-sha>' >&2; exit 2; }
git -C "$repo" cat-file -e "$commit^{commit}" || { echo 'commit is not available locally' >&2; exit 1; }
releases="$root/releases"; target="$releases/$commit"; temp="$releases/.${commit}.incomplete-$$"
release_owner="${BLACKSPIRE_RELEASE_OWNER:-root}"
release_group="${BLACKSPIRE_RELEASE_GROUP:-blackspire}"
[[ ! -L "$root" ]] || { echo 'release root must not be a symlink' >&2; exit 1; }
mkdir -p "$releases" "$root/shared/database" "$root/shared/evidence" "$root/shared/backups"
[[ ! -L "$releases" ]] || { echo 'release directory must not be a symlink' >&2; exit 1; }
if [[ -e "$target" ]]; then [[ -f "$target/.release-complete" ]] || { echo 'existing release is incomplete' >&2; exit 1; }; echo "$target"; exit 0; fi
cleanup_incomplete() {
  [[ -d "$temp" ]] && rm -rf -- "$temp"
}
trap cleanup_incomplete EXIT
rm -rf -- "$temp"; mkdir "$temp"
git -C "$repo" archive "$commit" | tar -x -C "$temp"
printf '%s\n' "$commit" > "$temp/COMMIT_SHA"
touch "$temp/.release-complete"
chown -hR "$release_owner:$release_group" "$temp"
find -P "$temp" -type d -exec chmod 0755 {} +
find -P "$temp" -type f -perm /111 -exec chmod 0755 {} +
find -P "$temp" -type f ! -perm /111 -exec chmod 0644 {} +
# Atomic, destination-safe promotion. -T (no-target-directory) guarantees the completed staging tree
# replaces exactly "$target" and is never moved *inside* it if a directory raced into existence. The
# durable VPS runs GNU coreutils on Linux (matching release-switch.sh's "mv -Tf"); the readiness test
# exercises this move to catch any platform without -T support.
mv -T -- "$temp" "$target"
trap - EXIT
echo "$target"
