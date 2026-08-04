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

readonly -a RELEASE_REQUIRED_FILES=(
  '.node-version'
  'package.json'
  'package-lock.json'
  'apps/api/server.js'
  'apps/worker/worker.js'
  'apps/jarvis-pwa/public/index.html'
  'packages/shared/config.js'
  'packages/shared/security.js'
  'packages/shared/schema-validation.js'
  'scripts/lib/node-bin.sh'
  'scripts/migrate.js'
  'scripts/backup.js'
  'scripts/restore.js'
  'scripts/production-supervisor.js'
  'scripts/production-preflight-check.js'
  'scripts/production-profile.env.example'
  'scripts/verify-environment.sh'
  'scripts/with-node.sh'
  'scripts/select-production-port.js'
  'scripts/health-check.sh'
  'scripts/gate4-prepare.sh'
  'scripts/start-production.sh'
  'scripts/release-create.sh'
  'scripts/release-preflight.sh'
  'scripts/release-switch.sh'
  'scripts/release-rollback.sh'
  'scripts/release-tree-validator.sh'
  'ops/blackspire-command-healthcheck.sh'
  'ops/blackspire-command-logrotate.conf'
  'ops/blackspire-command-monitor.sh'
  'ops/blackspire-command-monitor.service'
  'ops/blackspire-command-monitor.timer'
  'ops/blackspire-command-monitor-alert@.service'
  'ops/reverse-proxy/blackspire-command.nginx.conf'
  'ops/runtime-ownership/OWNERSHIP_MAP.md'
  'ops/runtime-ownership/blackspire-command.service'
  'ops/runtime-ownership/verify-ownership.sh'
)

release_validate_required_files() {
  local directory="$1" relative
  for relative in "${RELEASE_REQUIRED_FILES[@]}"; do
    [[ -f "$directory/$relative" && ! -L "$directory/$relative" && -s "$directory/$relative" ]] || {
      release_validation_error "release is missing required production artifact: $relative"
      return 1
    }
  done
}

release_validate_manifest() {
  local directory="$1" manifest="$directory/RELEASE_MANIFEST.sha256"
  local hash relative actual_hash entry_count=0 actual_count
  local -A seen=()
  [[ -f "$manifest" && ! -L "$manifest" && -s "$manifest" ]] || {
    release_validation_error 'release integrity manifest is missing or unsafe'
    return 1
  }
  [[ "$(tail -c 1 -- "$manifest" | od -An -tu1 | tr -d '[:space:]')" == 0 ]] || {
    release_validation_error 'release integrity manifest has trailing or incomplete data'
    return 1
  }
  while IFS= read -r -d '' hash; do
    IFS= read -r -d '' relative || { release_validation_error 'release integrity manifest contains an incomplete entry'; return 1; }
    [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || { release_validation_error 'release integrity manifest contains an invalid digest'; return 1; }
    [[ "$relative" == ./* && "$relative" != *'/../'* && "$relative" != './..' ]] || {
      release_validation_error 'release integrity manifest contains an unsafe path'
      return 1
    }
    [[ -z "${seen[$relative]+x}" ]] || { release_validation_error 'release integrity manifest contains a duplicate path'; return 1; }
    seen[$relative]=1
    [[ -f "$directory/$relative" && ! -L "$directory/$relative" ]] || {
      release_validation_error "release integrity target is missing or unsafe: $relative"
      return 1
    }
    actual_hash="$(sha256sum -- "$directory/$relative")" || return 1
    actual_hash="${actual_hash%% *}"
    [[ "$actual_hash" == "$hash" ]] || { release_validation_error "release content digest mismatch: $relative"; return 1; }
    entry_count=$((entry_count + 1))
  done < "$manifest"
  actual_count="$(find -P "$directory" -xdev -type f ! -path "$manifest" ! -path "$directory/.release-complete" -print0 | tr -cd '\0' | wc -c)" || return 1
  [[ "$entry_count" -eq "$actual_count" ]] || { release_validation_error 'release integrity manifest does not cover the exact file set'; return 1; }
}

release_validate_tree() {
  local directory="$1" require_marker="$2" invalid
  release_validate_exact_directory "$directory" || return 1
  [[ "$require_marker" != true || ( -f "$directory/.release-complete" && ! -L "$directory/.release-complete" && ! -s "$directory/.release-complete" ) ]] || { release_validation_error 'release is missing a safe completion marker'; return 1; }
  release_validate_no_special_files "$directory" || return 1
  invalid="$(find -P "$directory" -xdev -type l -print -quit)"
  [[ -z "$invalid" ]] || { release_validation_error "release contains a symlink and is not self-contained: $invalid"; return 1; }
  release_validate_required_files "$directory" || return 1
  release_validate_manifest "$directory" || return 1
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
  [[ -f "$target/COMMIT_SHA" && ! -L "$target/COMMIT_SHA" ]] || { release_validation_error 'release source identity is missing or unsafe'; return 1; }
  [[ "$(wc -c < "$target/COMMIT_SHA")" -eq 41 && "$(cat -- "$target/COMMIT_SHA")" == "$commit" ]] || { release_validation_error 'release source identity does not match its directory'; return 1; }
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
