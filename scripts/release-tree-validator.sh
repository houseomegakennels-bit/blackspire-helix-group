#!/usr/bin/env bash

# Shared fail-closed validation for immutable release trees.  It is sourced by
# release lifecycle commands and may also be executed directly as preflight.

release_validation_error() {
  printf '%s\n' "$1" >&2
  return 1
}

release_validate_root_path() {
  local candidate="$1" component
  local -a components
  [[ "$candidate" = /* && "$candidate" != / ]] || { release_validation_error 'release root must be a non-root absolute path'; return 1; }
  [[ "$candidate" != *'//'* ]] || { release_validation_error 'release path traversal is not allowed'; return 1; }
  IFS=/ read -r -a components <<< "${candidate#/}"
  for component in "${components[@]}"; do
    [[ "$component" != '.' && "$component" != '..' ]] || { release_validation_error 'release path traversal is not allowed'; return 1; }
  done
}

release_validate_no_symlink_ancestors() {
  local candidate="$1" current=/ component
  local -a components
  [[ "$candidate" = /* ]] || { release_validation_error 'release path must be absolute'; return 1; }
  IFS=/ read -r -a components <<< "${candidate#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="$current$component"
    [[ ! -L "$current" ]] || { release_validation_error "release path contains symlink: $current"; return 1; }
    [[ ! -e "$current" || -d "$current" ]] || { release_validation_error "release path component is not a directory: $current"; return 1; }
    current="$current/"
  done
}

release_validate_exact_directory() {
  local directory="$1" metadata
  [[ -d "$directory" && ! -L "$directory" ]] || { release_validation_error "required release directory is unsafe: $directory"; return 1; }
  metadata="$(stat -c '%U:%G:%a' -- "$directory")" || return 1
  [[ "$metadata" == 'root:blackspire:755' ]] || { release_validation_error "release directory contract failed: $directory ($metadata)"; return 1; }
}

release_validate_no_special_files() {
  local directory="$1" invalid
  invalid="$(find -P "$directory" -xdev \( -type b -o -type c -o -type p -o -type s \) -print -quit)"
  [[ -z "$invalid" ]] || { release_validation_error "release contains unexpected special file: $invalid"; return 1; }
}

release_validate_tree() {
  local directory="$1" require_marker="$2" invalid link resolved directory_real
  release_validate_exact_directory "$directory" || return 1
  directory_real="$(readlink -f -- "$directory")" || { release_validation_error "release directory cannot be canonicalized: $directory"; return 1; }
  [[ "$require_marker" != true || ( -f "$directory/.release-complete" && ! -L "$directory/.release-complete" ) ]] || { release_validation_error 'release is missing a safe completion marker'; return 1; }
  release_validate_no_special_files "$directory" || return 1
  while IFS= read -r -d '' link; do
    resolved="$(readlink -f -- "$link")" || { release_validation_error "release symlink cannot be canonicalized: $link"; return 1; }
    [[ -e "$resolved" ]] || { release_validation_error "release symlink is dangling: $link"; return 1; }
    [[ "$resolved" == "$directory_real" || "$resolved" == "$directory_real/"* ]] || { release_validation_error "release symlink escapes containment: $link"; return 1; }
  done < <(find -P "$directory" -xdev -type l -print0)
  invalid="$(find -P "$directory" -xdev -type d ! -perm 0755 -print -quit)"
  [[ -z "$invalid" ]] || { release_validation_error "release directory mode contract failed: $invalid"; return 1; }
  invalid="$(find -P "$directory" -xdev -type f ! -perm 0644 ! -perm 0755 -print -quit)"
  [[ -z "$invalid" ]] || { release_validation_error "release file mode contract failed: $invalid"; return 1; }
  invalid="$(find -P "$directory" -xdev \( \( -type d -o -type f \) ! -user root -o \( -type d -o -type f \) ! -group blackspire \) -print -quit)"
  [[ -z "$invalid" ]] || { release_validation_error "release ownership contract failed: $invalid"; return 1; }
}

release_validate_completed_release() {
  local root="$1" commit="$2" releases target
  release_validate_root_path "$root" || return 1
  release_validate_no_symlink_ancestors "$root" || return 1
  releases="$root/releases"
  target="$releases/$commit"
  release_validate_no_symlink_ancestors "$releases" || return 1
  [[ -d "$target" && ! -L "$target" ]] || { release_validation_error 'release destination is missing or unsafe'; return 1; }
  release_validate_tree "$target" true
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  commit="${1:-}"
  root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'usage: release-tree-validator.sh <full-commit-sha>' >&2; exit 2; }
  root="${root%/}"
  [[ -n "$root" ]] || root=/
  release_validate_completed_release "$root" "$commit"
fi
