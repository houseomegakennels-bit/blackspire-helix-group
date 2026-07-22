#!/usr/bin/env bash
set -euo pipefail

commit="${1:-}"
root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
repo="${BLACKSPIRE_SOURCE_ROOT:-$(git rev-parse --show-toplevel)}"
releases=""
target=""
temp=""

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

assert_clean_release_root() {
  local candidate="$1" component
  local -a components
  [[ "$candidate" = /* && "$candidate" != / ]] || fail 'release root must be a non-root absolute path'
  [[ "$candidate" != *'//'* ]] || fail 'release path traversal is not allowed'
  IFS=/ read -r -a components <<< "${candidate#/}"
  for component in "${components[@]}"; do
    [[ "$component" != '.' && "$component" != '..' ]] || fail 'release path traversal is not allowed'
  done
}

assert_no_symlink_ancestors() {
  local candidate="$1" current=/ component
  [[ "$candidate" = /* ]] || fail 'release path must be absolute'
  IFS=/ read -r -a components <<< "${candidate#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="$current$component"
    [[ ! -L "$current" ]] || fail "release path contains symlink: $current"
    if [[ -e "$current" && ! -d "$current" ]]; then
      fail "release path component is not a directory: $current"
    fi
    current="$current/"
  done
}

assert_exact_directory_contract() {
  local directory="$1" metadata
  [[ -d "$directory" && ! -L "$directory" ]] || fail "required release directory is unsafe: $directory"
  metadata="$(stat -c '%U:%G:%a' -- "$directory")"
  [[ "$metadata" == 'root:blackspire:755' ]] || fail "release directory contract failed: $directory ($metadata)"
}

assert_no_special_files() {
  local directory="$1" special
  special="$(find -P "$directory" -xdev \( -type b -o -type c -o -type p -o -type s \) -print -quit)"
  [[ -z "$special" ]] || fail "release contains unexpected special file: $special"
}

assert_release_tree_contract() {
  local directory="$1" invalid
  assert_exact_directory_contract "$directory"
  [[ -f "$directory/.release-complete" && ! -L "$directory/.release-complete" ]] || fail 'release is missing a safe completion marker'
  assert_no_special_files "$directory"
  invalid="$(find -P "$directory" -xdev -type d ! -perm 0755 -print -quit)"
  [[ -z "$invalid" ]] || fail "release directory mode contract failed: $invalid"
  invalid="$(find -P "$directory" -xdev -type f ! -perm 0644 ! -perm 0755 -print -quit)"
  [[ -z "$invalid" ]] || fail "release file mode contract failed: $invalid"
  invalid="$(find -P "$directory" -xdev \( \( -type d -o -type f \) ! -user root -o \( -type d -o -type f \) ! -group blackspire \) -print -quit)"
  [[ -z "$invalid" ]] || fail "release ownership contract failed: $invalid"
}

cleanup_incomplete() {
  if [[ -n "$temp" && -d "$temp" && ! -L "$temp" ]]; then
    rm -rf -- "$temp"
  fi
}

assert_clean_release_root "$root"
assert_no_symlink_ancestors "$root"
getent passwd root >/dev/null || fail 'required release owner root is unavailable'
getent group blackspire >/dev/null || fail 'required release group blackspire is unavailable'
mkdir -p -- "$root"
assert_no_symlink_ancestors "$root"
chown root:blackspire -- "$root"
chmod 0755 -- "$root"
assert_exact_directory_contract "$root"

mkdir -p -- "$releases"
assert_no_symlink_ancestors "$releases"
chown root:blackspire -- "$releases"
chmod 0755 -- "$releases"
assert_exact_directory_contract "$releases"

if [[ -e "$target" || -L "$target" ]]; then
  [[ ! -L "$target" ]] || fail 'existing release destination must not be a symlink'
  assert_release_tree_contract "$target"
  echo "$target"
  exit 0
fi

trap cleanup_incomplete EXIT
mkdir -- "$temp"
git -C "$repo" archive "$commit" | tar -x -C "$temp"
printf '%s\n' "$commit" > "$temp/COMMIT_SHA"
assert_no_special_files "$temp"
chown -R root:blackspire -- "$temp"
find -P "$temp" -type d -exec chmod 0755 {} +
find -P "$temp" -type f -perm /111 -exec chmod 0755 {} +
find -P "$temp" -type f ! -perm /111 -exec chmod 0644 {} +

# The marker is intentionally last: consumers may trust a release only after all
# content has been copied, normalized, and validated against the immutable contract.
assert_exact_directory_contract "$temp"
assert_no_special_files "$temp"
marker="$temp/.release-complete"
[[ ! -e "$marker" && ! -L "$marker" ]] || fail 'release completion marker already exists or is unsafe'
set -C
: > "$marker"
set +C
[[ -f "$marker" && ! -L "$marker" ]] || fail 'release completion marker cannot be written safely'
chown root:blackspire -- "$marker"
chmod 0644 -- "$marker"
assert_release_tree_contract "$temp"

[[ ! -e "$target" && ! -L "$target" ]] || fail 'release destination appeared during creation'
mv -T -- "$temp" "$target"
trap - EXIT
assert_release_tree_contract "$target"
echo "$target"
