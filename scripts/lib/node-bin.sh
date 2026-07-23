#!/usr/bin/env bash
# Deterministic Node interpreter resolution for every production startup path.
#
# systemd's manager PATH is /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin and does
# NOT include /opt/nodejs, so a bare `node` in any unit-invoked helper silently resolves to the
# distribution's Node 18. The control plane requires node:sqlite (packages/task-engine/db.js,
# scripts/backup.js, scripts/restore.js), which does not exist before Node 22.5, so that
# resolution is never correct for the durable production runtime.
#
# Resolution order is explicit, and whatever is chosen must satisfy the node:sqlite floor or this
# fails closed. Nothing here silently falls back to an interpreter that cannot run the product.
#
#   1. BLACKSPIRE_NODE_BIN, when set, is used verbatim. This is the only override, and it exists
#      so tests, CI images, and non-VPS hosts can pin their own interpreter explicitly.
#   2. The reviewed durable-VPS interpreter, when present and executable.
#   3. `node` from PATH, as a last resort for development and CI images that have no /opt/nodejs.
#
# The floor check is applied to the resolved interpreter in every case, including case 3, so a
# PATH-resolved Node 18 fails closed with a clear message instead of failing later inside the app.

# The reviewed durable-VPS interpreter. Overridable only for tests; production pins this exact path
# in ops/runtime-ownership/blackspire-command.service.
BLACKSPIRE_REVIEWED_NODE_BIN="${BLACKSPIRE_REVIEWED_NODE_BIN:-/opt/nodejs/node-v22.23.1-linux-x64/bin/node}"

# Print the resolved interpreter on stdout, or fail closed with a message on stderr.
blackspire_resolve_node() {
  local candidate=""
  if [[ -n "${BLACKSPIRE_NODE_BIN:-}" ]]; then
    candidate="$BLACKSPIRE_NODE_BIN"
  elif [[ -x "$BLACKSPIRE_REVIEWED_NODE_BIN" ]]; then
    candidate="$BLACKSPIRE_REVIEWED_NODE_BIN"
  else
    candidate="$(command -v node 2>/dev/null || true)"
  fi

  [[ -n "$candidate" ]] || { echo 'node interpreter is unavailable' >&2; return 1; }
  [[ -x "$candidate" ]] || { echo 'resolved node interpreter is not executable' >&2; return 1; }
  "$candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<5))process.exit(1)' 2>/dev/null \
    || { echo 'resolved node interpreter is older than 22.5 and cannot provide node:sqlite' >&2; return 1; }

  printf '%s\n' "$candidate"
}
