#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
port="${PORT:-8790}"
ttl_ms="${UNIFIED_TEST_TTL_MS:-7200000}"
runtime_dir="${BLACKSPIRE_IPHONE_RUNTIME_DIR:-/tmp/blackspire-iphone-${UID}}"
tunnel="${1:-local}"
cloudflared_image="cloudflare/cloudflared:2026.7.2@sha256:18626b1baac4450214535cd5bc40ef44c0635244d585ebf707749c22b6f3408f"
tunnel_name="blackspire-iphone-tunnel-${UID}"

[[ "$port" != "8787" ]] || { echo 'port 8787 is reserved for the durable VPS runtime' >&2; exit 1; }
[[ ! -e "$runtime_dir/app.pid" ]] || { echo 'a disposable iPhone test is already recorded' >&2; exit 1; }
install -d -m 0700 "$runtime_dir"
access_code="$(openssl rand -hex 12)"
printf '%s\n' "$access_code" > "$runtime_dir/access-code"
chmod 0600 "$runtime_dir/access-code"

cleanup_startup() { bash scripts/stop-iphone-test.sh >/dev/null 2>&1 || true; }
trap cleanup_startup INT TERM ERR

env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test BLACKSPIRE_ENVIRONMENT=iphone-test BLACKSPIRE_STATE_OWNER=iphone-test-disposable BLACKSPIRE_PROVIDER_MODE=mock UNIFIED_IPHONE_TEST_MODE=true UNIFIED_TEST_ACCESS_CODE="$access_code" HERMES_TEST_PROVIDER=mock TELEGRAM_MODE=mock BLACKSPIRE_DB_PATH="/tmp/blackspire-test-launcher.sqlite" bash scripts/verify-environment.sh iphone-test >/dev/null

env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test BLACKSPIRE_ENVIRONMENT=iphone-test BLACKSPIRE_STATE_OWNER=iphone-test-disposable BLACKSPIRE_PROVIDER_MODE=mock UNIFIED_IPHONE_TEST_MODE=true UNIFIED_TEST_ACCESS_CODE="$access_code" HERMES_TEST_PROVIDER=mock TELEGRAM_MODE=mock BLACKSPIRE_DB_PATH="/tmp/blackspire-test-launcher.sqlite" UNIFIED_TEST_TTL_MS="$ttl_ms" PORT="$port" nohup node scripts/start-iphone-test-build.js >"$runtime_dir/app.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" > "$runtime_dir/app.pid"

for _ in $(seq 1 40); do
  if PORT="$port" bash scripts/health-check.sh "http://127.0.0.1:$port" iphone-test >/dev/null 2>&1; then break; fi
  kill -0 "$app_pid" 2>/dev/null || { echo 'iPhone test application failed to start' >&2; exit 1; }
  sleep 0.25
done
PORT="$port" bash scripts/health-check.sh "http://127.0.0.1:$port" iphone-test >/dev/null

preview_url="http://127.0.0.1:$port"
if [[ "$tunnel" == "quick-tunnel" ]]; then
  docker run --rm --name "$tunnel_name" --network host "$cloudflared_image" tunnel --no-autoupdate --url "http://127.0.0.1:$port" >"$runtime_dir/tunnel.log" 2>&1 &
  printf '%s\n' "$tunnel_name" > "$runtime_dir/tunnel.container"
  for _ in $(seq 1 60); do
    preview_url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$runtime_dir/tunnel.log" | tail -n 1 || true)"
    [[ -n "$preview_url" ]] && break
    sleep 0.5
  done
  [[ -n "$preview_url" ]] || { echo 'Quick Tunnel failed to provide a URL' >&2; exit 1; }
elif [[ "$tunnel" != "local" && "$tunnel" != "codespace" ]]; then
  echo 'usage: start-iphone-test.sh [local|codespace|quick-tunnel]' >&2
  exit 1
fi

( sleep "$((ttl_ms / 1000))"; rm -f "$runtime_dir/watcher.pid"; bash "$repo_root/scripts/stop-iphone-test.sh" >/dev/null 2>&1 ) &
printf '%s\n' "$!" > "$runtime_dir/watcher.pid"
trap - INT TERM ERR
printf 'BLACKSPIRE TEST MODE\nURL: %s\nOne-time access code: %s\nExpires automatically; provider=mock; telegram=mock; production-data=no\n' "$preview_url" "$access_code"
