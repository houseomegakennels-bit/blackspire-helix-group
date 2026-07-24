#!/usr/bin/env bash
set -euo pipefail
# Health is scraped on the same loopback host and explicit port the runtime binds. There is no
# default: an unset port fails closed rather than silently probing the existing 8787 listener.
if [[ -n "${BLACKSPIRE_HEALTH_URL:-}" ]]; then
  base_url="$BLACKSPIRE_HEALTH_URL"
else
  host="${BIND_HOST:-127.0.0.1}"
  port="${PORT:-}"
  [[ -n "$port" ]] || { echo 'healthcheck requires PORT (or BLACKSPIRE_HEALTH_URL); there is no default' >&2; exit 2; }
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || { echo 'healthcheck PORT must be an explicit decimal integer' >&2; exit 2; }
  base_url="http://${host}:${port}"
fi
# The interpreter is resolved deterministically: this runs from monitoring and timer contexts whose
# PATH does not include /opt/nodejs, where a bare `node` would be the distribution's Node 18.
# shellcheck source=../scripts/lib/node-bin.sh
. "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib/node-bin.sh"
node_bin="$(blackspire_resolve_node)" || { echo 'healthcheck requires Node 22.5 or newer' >&2; exit 2; }
curl --fail --silent --show-error --max-time "${BLACKSPIRE_HEALTH_TIMEOUT_SECONDS:-5}" "$base_url/health" | "$node_bin" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);if(b.ok!==true||b.service!=='blackspire-command-api'||b.telegramMode==='polling')process.exit(1)})"
