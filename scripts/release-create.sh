#!/usr/bin/env bash
set -euo pipefail

commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
repo="${BLACKSPIRE_SOURCE_ROOT:-$(git rev-parse --show-toplevel)}"
releases=""
target=""
temp=""

source "$(dirname "$0")/release-tree-validator.sh"

fail() {
  echo "$1" >&2
  exit 1
}

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-create.sh <full-commit-sha>' >&2; exit 2; }
[[ "$root" = /* ]] || fail 'release root must be an absolute path'
git -C "$repo" cat-file -e "$commit^{commit}" || fail 'commit is not available locally'

root="${root%/}"
[[ -n "$root" ]] || root=/
releases="$root/releases"
target="$releases/$commit"
temp="$releases/.${commit}.incomplete-$$"

cleanup_incomplete() {
  if [[ -n "$temp" && -d "$temp" && ! -L "$temp" ]]; then
    rm -rf -- "$temp"
  fi
}

release_validate_root_path "$root" || exit 1
release_validate_no_symlink_ancestors "$root" || exit 1
getent passwd root >/dev/null || fail 'required release owner root is unavailable'
getent group blackspire >/dev/null || fail 'required release group blackspire is unavailable'
mkdir -p -- "$root"
release_validate_no_symlink_ancestors "$root" || exit 1
chown root:blackspire -- "$root"
chmod 0755 -- "$root"
release_validate_exact_directory "$root" || exit 1

mkdir -p -- "$releases"
release_validate_no_symlink_ancestors "$releases" || exit 1
chown root:blackspire -- "$releases"
chmod 0755 -- "$releases"
release_validate_exact_directory "$releases" || exit 1

if [[ -e "$target" || -L "$target" ]]; then
  [[ ! -L "$target" ]] || fail 'existing release destination must not be a symlink'
  release_validate_completed_release "$root" "$commit" || exit 1
  echo "$target"
  exit 0
fi

trap cleanup_incomplete EXIT
mkdir -- "$temp"
git -C "$repo" archive "$commit" | tar -x -C "$temp" --exclude='.agents' --exclude='.claude' --exclude='.devcontainer' --exclude='.github' --exclude='.githooks' --exclude='.vscode' --exclude='AGENTS.md' --exclude='tests'
printf '%s\n' "$commit" > "$temp/COMMIT_SHA"
release_validate_no_special_files "$temp" || exit 1
chown -R root:blackspire -- "$temp"
find -P "$temp" -type d -exec chmod 0755 {} +
find -P "$temp" -type f -perm /111 -exec chmod 0755 {} +
find -P "$temp" -type f ! -perm /111 -exec chmod 0644 {} +

# The marker is intentionally last: consumers may trust a release only after all
# content has been copied, normalized, and validated against the immutable contract.
release_validate_tree "$temp" false || exit 1
marker="$temp/.release-complete"
[[ ! -e "$marker" && ! -L "$marker" ]] || fail 'release completion marker already exists or is unsafe'
set -C
: > "$marker"
set +C
[[ -f "$marker" && ! -L "$marker" ]] || fail 'release completion marker cannot be written safely'
chown root:blackspire -- "$marker"
chmod 0644 -- "$marker"
release_validate_tree "$temp" true || exit 1

[[ ! -e "$target" && ! -L "$target" ]] || fail 'release destination appeared during creation'
mv -T -- "$temp" "$target"
trap - EXIT
release_validate_completed_release "$root" "$commit" || exit 1
echo "$target"
