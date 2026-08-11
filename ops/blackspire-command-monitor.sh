#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '{"service":"blackspire-command-monitor","ok":false,"error":"%s"}\n' "$1" >&2
  exit 2
}

# Provider-neutral production monitor. systemd creates the durable state directory; tests may point
# it at a disposable directory. Alert delivery is intentionally delegated to the unit's OnFailure
# target and must be configured and exercised by the operator.
state_dir="${BLACKSPIRE_MONITOR_STATE_DIR:-/var/lib/blackspire-command-monitor}"
database_path="${BLACKSPIRE_DB_PATH:-}"
[[ -n "$database_path" && "$database_path" = /* ]] || fail database_path_required
[[ -d "$state_dir" && ! -L "$state_dir" ]] || fail state_directory_unavailable

umask 0027
counter_file="$state_dir/consecutive-health-failures"
counter=0
if [[ -e "$counter_file" ]]; then
  [[ -f "$counter_file" && ! -L "$counter_file" ]] || fail state_counter_invalid
  IFS= read -r counter 2>/dev/null < "$counter_file" || fail state_counter_invalid
  [[ "$counter" =~ ^[0-9]+$ && "$counter" -le 1000000 ]] || fail state_counter_invalid
fi

health_ok=false
if "$(dirname "${BASH_SOURCE[0]}")/blackspire-command-healthcheck.sh" >/dev/null 2>&1; then
  health_ok=true
  counter=0
else
  counter=$((counter + 1))
fi

tmp="$(mktemp "$state_dir/.consecutive-health-failures.XXXXXX" 2>/dev/null)" || fail state_write_failed
trap 'rm -f -- "$tmp" 2>/dev/null || :' EXIT
printf '%s\n' "$counter" 2>/dev/null > "$tmp" || fail state_write_failed
chmod 0640 "$tmp" 2>/dev/null || fail state_write_failed
mv -f -- "$tmp" "$counter_file" 2>/dev/null || fail state_write_failed
trap - EXIT

database_dir="$(dirname "$database_path")"
disk_used="$(timeout --signal=KILL 5s df -P -- "$database_dir" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }' 2>/dev/null)" || fail disk_metric_unavailable
[[ "$disk_used" =~ ^[0-9]+$ && "$disk_used" -le 100 ]] || fail disk_metric_invalid
disk_free=$((100 - disk_used))

alert=false
reason="healthy"
if (( disk_free < 20 )); then
  alert=true
  reason="database_disk_below_20_percent"
elif [[ "$health_ok" == false ]] && (( counter >= 3 )); then
  alert=true
  reason="three_consecutive_health_failures"
elif [[ "$health_ok" == false ]]; then
  reason="health_failure_below_alert_threshold"
fi

printf '{"service":"blackspire-command-monitor","ok":%s,"healthOk":%s,"consecutiveHealthFailures":%s,"databaseDiskFreePercent":%s,"reason":"%s"}\n' \
  "$([[ "$alert" == false ]] && printf true || printf false)" "$health_ok" "$counter" "$disk_free" "$reason"
[[ "$alert" == false ]]
