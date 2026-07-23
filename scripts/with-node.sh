#!/usr/bin/env bash
# Run a Node script through the canonical resolved interpreter.
#
# The migration, backup, and restore entry points are part of the Gate 4 activation path:
# scripts/backup.js and scripts/restore.js import node:sqlite, so running them through a bare
# `node` would use the distribution's Node 18 on the durable VPS and fail. Routing them through
# this wrapper keeps every activation command on the same interpreter as the systemd unit.
#
# Usage: bash scripts/with-node.sh <script.js> [args...]
set -euo pipefail

# shellcheck source=scripts/lib/node-bin.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-bin.sh"

node_bin="$(blackspire_resolve_node)" || exit 1
exec "$node_bin" "$@"
