#!/usr/bin/env bash
set -euo pipefail
base_url="${BLACKSPIRE_HEALTH_URL:-http://127.0.0.1:8787}"
curl --fail --silent --show-error --max-time "${BLACKSPIRE_HEALTH_TIMEOUT_SECONDS:-5}" "$base_url/health" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);if(b.ok!==true||b.service!=='blackspire-command-api'||b.telegramMode==='polling')process.exit(1)})"
