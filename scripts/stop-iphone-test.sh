#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${BLACKSPIRE_IPHONE_RUNTIME_DIR:-/tmp/blackspire-iphone-${UID}}"
port="${PORT:-8790}"

stop_pid_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(<"$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  [[ "$pid" != "$$" && "$pid" != "$PPID" ]] || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  kill -KILL "$pid" 2>/dev/null || true
}

stop_pid_file "$runtime_dir/watcher.pid"
stop_pid_file "$runtime_dir/app.pid"
if [[ -f "$runtime_dir/tunnel.container" ]]; then
  tunnel_name="$(<"$runtime_dir/tunnel.container")"
  [[ "$tunnel_name" == "blackspire-iphone-tunnel-${UID}" ]] && docker rm -f "$tunnel_name" >/dev/null 2>&1 || true
fi
rm -rf -- "$runtime_dir"
if curl --silent --max-time 1 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  echo 'test health endpoint is still reachable' >&2
  exit 1
fi
printf 'BLACKSPIRE TEST MODE STOPPED: disposable-state=removed tunnel=stopped\n'
