#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:${PORT:-8790}}"
mode="${2:-health}"
health="$(curl --fail --silent --show-error --max-time 5 "$base_url/health")"
HEALTH_JSON="$health" node -e "const b=JSON.parse(process.env.HEALTH_JSON);if(b.ok!==true||b.service!=='blackspire-command-api')process.exit(1)"
if [[ "$mode" == "iphone-test" ]]; then
  status="$(curl --fail --silent --show-error --max-time 5 "$base_url/api/test-mode")"
  STATUS_JSON="$status" node -e "const b=JSON.parse(process.env.STATUS_JSON);if(!b.enabled||b.provider!=='mock'||b.telegram!=='mock'||b.productionData!==false||Date.parse(b.expiresAt)<=Date.now())process.exit(1)"
fi
printf 'BLACKSPIRE HEALTH OK: mode=%s\n' "$mode"
