#!/usr/bin/env bash
set -euo pipefail

# The health target is always explicit, mirroring ops/blackspire-command-healthcheck.sh: either an
# approved health URL or a valid PORT for a loopback request. There is no default port. The former
# ${PORT:-8790} fallback silently probed a production-candidate port this script does not own, so a
# missing target now fails closed instead. Errors state the requirement only, never any value.
if [[ -n "${1:-}" ]]; then
  base_url="$1"
elif [[ -n "${BLACKSPIRE_HEALTH_URL:-}" ]]; then
  base_url="$BLACKSPIRE_HEALTH_URL"
else
  host="${BIND_HOST:-127.0.0.1}"
  port="${PORT:-}"
  [[ -n "$port" ]] || { echo 'health-check requires PORT (or an explicit health URL); there is no default' >&2; exit 2; }
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || { echo 'health-check PORT must be an explicit decimal integer' >&2; exit 2; }
  base_url="http://${host}:${port}"
fi
mode="${2:-health}"
# shellcheck source=scripts/lib/node-bin.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-bin.sh"
node_bin="$(blackspire_resolve_node)" || { echo 'health-check requires Node 22.5 or newer' >&2; exit 2; }
health="$(curl --fail --silent --show-error --max-time 5 "$base_url/health")"
HEALTH_JSON="$health" "$node_bin" -e "const b=JSON.parse(process.env.HEALTH_JSON);if(b.ok!==true||b.service!=='blackspire-command-api')process.exit(1)"
if [[ "$mode" == "iphone-test" ]]; then
  status="$(curl --fail --silent --show-error --max-time 5 "$base_url/api/test-mode")"
  STATUS_JSON="$status" "$node_bin" -e "const b=JSON.parse(process.env.STATUS_JSON);if(!b.enabled||b.provider!=='mock'||b.telegram!=='mock'||b.productionData!==false||Date.parse(b.expiresAt)<=Date.now())process.exit(1)"
fi
printf 'BLACKSPIRE HEALTH OK: mode=%s\n' "$mode"
