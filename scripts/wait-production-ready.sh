#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'usage: wait-production-ready.sh <base-url> <api-unit> <worker-unit> <timeout-seconds> <poll-seconds>' >&2
  exit 2
}

[[ $# -eq 5 ]] || usage
base_url="$1"
api_unit="$2"
worker_unit="$3"
timeout_seconds="$4"
poll_seconds="$5"
systemctl_bin="${BLACKSPIRE_GATE4_SYSTEMCTL:-systemctl}"

[[ "$base_url" =~ ^http://(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$ ]] || { echo 'production readiness requires an explicit loopback URL' >&2; exit 2; }
[[ "$api_unit" =~ ^[A-Za-z0-9_.@:-]+\.service$ ]] || { echo 'production readiness requires a valid API unit name' >&2; exit 2; }
[[ "$worker_unit" =~ ^[A-Za-z0-9_.@:-]+\.service$ ]] || { echo 'production readiness requires a valid worker unit name' >&2; exit 2; }
[[ "$timeout_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || { echo 'production readiness requires a bounded integer timeout' >&2; exit 2; }
[[ "$poll_seconds" =~ ^(0\.[1-9][0-9]{0,2}|[1-9][0-9]{0,2}(\.[0-9]{1,3})?)$ ]] || { echo 'production readiness requires a positive bounded poll interval' >&2; exit 2; }

# shellcheck source=scripts/lib/node-bin.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-bin.sh"
node_bin="$(blackspire_resolve_node)" || { echo 'production readiness requires Node 22.5 or newer' >&2; exit 2; }
deadline_ms=$(( $(date +%s%3N) + timeout_seconds * 1000 ))

unit_state() {
  "$systemctl_bin" show "$1" --property=ActiveState --property=InvocationID 2>/dev/null | awk -F= '
    $1 == "ActiveState" { active=$2 }
    $1 == "InvocationID" { invocation=$2 }
    END { print active, invocation }
  '
}

while (( $(date +%s%3N) < deadline_ms )); do
  api_state="$(unit_state "$api_unit" || true)"
  worker_state="$(unit_state "$worker_unit" || true)"
  read -r api_active api_generation <<<"$api_state"
  read -r worker_active worker_generation <<<"$worker_state"
  if [[ "$api_active" == active && "$api_generation" =~ ^[a-f0-9]{32}$ && "$worker_active" == active && "$worker_generation" =~ ^[a-f0-9]{32}$ ]]; then
    remaining_ms=$(( deadline_ms - $(date +%s%3N) ))
    (( remaining_ms > 0 )) || break
    # Two requests share the remaining budget; neither may consume the whole deadline by itself.
    request_seconds="$(awk -v ms="$remaining_ms" 'BEGIN { v=ms/2000; if (v>2) v=2; if (v<0.01) v=0.01; printf "%.3f", v }')"
    health="$(curl --fail --silent --show-error --max-time "$request_seconds" --max-filesize 65536 "$base_url/health" 2>/dev/null || true)"
    ready="$(curl --fail --silent --show-error --max-time "$request_seconds" --max-filesize 65536 "$base_url/ready" 2>/dev/null || true)"
    if HEALTH_JSON="$health" READY_JSON="$ready" EXPECTED_GENERATION="$worker_generation" "$node_bin" -e '
      try {
        const health = JSON.parse(process.env.HEALTH_JSON);
        const ready = JSON.parse(process.env.READY_JSON);
        if (health.ok !== true || health.service !== "blackspire-command-api") process.exit(1);
        if (ready.ok !== true || ready.service !== "blackspire-command-api") process.exit(1);
        if (ready.dependencies?.worker?.generationId !== process.env.EXPECTED_GENERATION) process.exit(1);
      } catch { process.exit(1); }
    ' 2>/dev/null; then
      # Close the heartbeat-after-death and API-after-response windows before authorizing enable.
      final_api_state="$(unit_state "$api_unit" || true)"
      final_worker_state="$(unit_state "$worker_unit" || true)"
      read -r final_api_active final_api_generation <<<"$final_api_state"
      read -r final_worker_active final_worker_generation <<<"$final_worker_state"
      if [[ "$final_api_active" == active && "$final_api_generation" == "$api_generation" && "$final_worker_active" == active && "$final_worker_generation" == "$worker_generation" ]]; then
        echo 'BLACKSPIRE ACTIVATION-SPECIFIC READINESS OK'
        exit 0
      fi
    fi
  fi
  remaining_ms=$(( deadline_ms - $(date +%s%3N) ))
  (( remaining_ms > 0 )) || break
  sleep_seconds="$(awk -v poll="$poll_seconds" -v ms="$remaining_ms" 'BEGIN { v=ms/1000; if (poll<v) v=poll; printf "%.3f", v }')"
  sleep "$sleep_seconds"
done

echo 'production activation readiness timed out before current service generation was proven' >&2
exit 1
