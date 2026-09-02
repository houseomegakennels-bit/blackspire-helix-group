#!/usr/bin/env bash
set -euo pipefail

approved_sha="${BLACKSPIRE_GATE4_APPROVED_SHA:-}"
[[ "$approved_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'a full approved SHA is required' >&2; exit 2; }

env_file="${BLACKSPIRE_PRODUCTION_ENV_FILE:-/etc/blackspire/command.env}"
api_env_file="${BLACKSPIRE_PRODUCTION_API_ENV_FILE:-/etc/blackspire/command-api.env}"
[[ -f "$env_file" && ! -L "$env_file" ]] || { echo 'cannot resolve workspace from a safe production environment file' >&2; exit 1; }
workspace_root="$(sed -nE 's/^[[:space:]]*BLACKSPIRE_WORKSPACE_ROOT=(.*)$/\1/p' -- "$env_file" | tail -n 1)"
workspace_root="${workspace_root%\"}"; workspace_root="${workspace_root#\"}"
workspace_root="${workspace_root%\'}"; workspace_root="${workspace_root#\'}"
[[ -n "$workspace_root" && "$workspace_root" == /* ]] || { echo 'production workspace root must be an absolute path' >&2; exit 1; }
logrotate_file="${BLACKSPIRE_GATE4_LOGROTATE_FILE:-/etc/logrotate.d/blackspire-command}"
api_unit="${BLACKSPIRE_GATE4_API_UNIT_FILE:-/etc/systemd/system/blackspire-command.service}"
worker_unit="${BLACKSPIRE_GATE4_WORKER_UNIT_FILE:-/etc/systemd/system/blackspire-command-worker.service}"
target_unit="${BLACKSPIRE_GATE4_TARGET_FILE:-/etc/systemd/system/blackspire-command.target}"
backup_dir="${BLACKSPIRE_GATE4_UNIT_BACKUP_DIR:-/var/backups/blackspire-command/gate4-$approved_sha}"
systemctl_bin="${BLACKSPIRE_GATE4_SYSTEMCTL:-systemctl}"
install_bin="${BLACKSPIRE_GATE4_INSTALL_BIN:-install}"
units=("$api_unit" "$worker_unit" "$target_unit")
non_units=("$env_file" "$api_env_file" "$workspace_root" "$logrotate_file")

[[ -f "$backup_dir/.complete" && ! -L "$backup_dir/.complete" ]] || { echo 'missing safe complete snapshot marker' >&2; exit 1; }
for unit in "${units[@]}"; do
  base="$(basename -- "$unit")"
  present=0; absent=0
  [[ -f "$backup_dir/$base" && ! -L "$backup_dir/$base" ]] && present=1
  [[ -f "$backup_dir/$base.absent" && ! -L "$backup_dir/$base.absent" ]] && absent=1
  (( present + absent == 1 )) || { echo "missing or ambiguous trusted before-state: $unit" >&2; exit 1; }
  if [[ -e "$unit" || -L "$unit" ]]; then
    [[ -f "$unit" && ! -L "$unit" ]] || { echo "unsafe rollback destination: $unit" >&2; exit 1; }
  fi
done
for index in "${!non_units[@]}"; do
  item="${non_units[$index]}"
  [[ ! -e "$item" && ! -L "$item" ]] && continue
  if (( index == 2 )); then
    [[ -d "$item" && ! -L "$item" ]] || { echo "unsafe rollback destination: $item" >&2; exit 1; }
  else
    [[ -f "$item" && ! -L "$item" ]] || { echo "unsafe rollback destination: $item" >&2; exit 1; }
  fi
done

repair_dir="$(mktemp -d "$(dirname -- "$api_unit")/.blackspire-gate4-repair.XXXXXX")"
moved_unit_destinations=()
moved_unit_staged=()
moved_unit_was_present=()
moved_non_unit_destinations=()
moved_non_unit_staged=()
staging_dirs=()
compensate() {
  trap - ERR
  set +e
  for index in "${!moved_unit_destinations[@]}"; do
    rm -f -- "${moved_unit_destinations[$index]}"
    (( moved_unit_was_present[index] == 0 )) || mv -T -- "${moved_unit_staged[$index]}" "${moved_unit_destinations[$index]}"
  done
  for index in "${!moved_non_unit_destinations[@]}"; do
    mv -T -- "${moved_non_unit_staged[$index]}" "${moved_non_unit_destinations[$index]}"
  done
  for directory in "${staging_dirs[@]}"; do rmdir -- "$directory"; done
  "$systemctl_bin" daemon-reload >/dev/null 2>&1
  rm -rf -- "$repair_dir"
  echo 'preparation rollback failed; prepared state compensation attempted' >&2
  exit 1
}
trap compensate ERR

for unit in "${units[@]}"; do
  base="$(basename -- "$unit")"
  if [[ -f "$unit" ]]; then
    staged="$repair_dir/$base.prepared"
    mv -T -- "$unit" "$staged"
    moved_unit_was_present+=(1)
  else
    staged="$repair_dir/$base.absent"
    : > "$staged"
    moved_unit_was_present+=(0)
  fi
  moved_unit_destinations+=("$unit")
  moved_unit_staged+=("$staged")
  if [[ -f "$backup_dir/$base" ]]; then
    "$install_bin" -T -o "$(id -u)" -g "$(id -g)" -m 0644 "$backup_dir/$base" "$unit"
  else
    rm -f -- "$unit"
  fi
done
"$systemctl_bin" daemon-reload

for item in "${non_units[@]}"; do
  if [[ -e "$item" ]]; then
    staging_dir="$(mktemp -d "$(dirname -- "$item")/.blackspire-gate4-remove.XXXXXX")"
    staging_dirs+=("$staging_dir")
    staged="$staging_dir/value"
    mv -T -- "$item" "$staged"
    moved_non_unit_destinations+=("$item")
    moved_non_unit_staged+=("$staged")
  fi
done

trap - ERR
rm -rf -- "$repair_dir"
for staged in "${moved_non_unit_staged[@]}"; do rm -rf -- "$staged"; done
for directory in "${staging_dirs[@]}"; do rmdir -- "$directory"; done
echo 'Gate 4 preparation rollback complete; production was not activated'
