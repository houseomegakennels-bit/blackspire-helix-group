#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

cd "$REPO_ROOT"

if [ -f scripts/agent-start.sh ]; then
  bash scripts/agent-start.sh
fi

if ! command -v codex >/dev/null 2>&1; then
  echo ""
  echo "ERROR: codex is not installed or not on PATH."
  exit 1
fi

if [ "${CODEX_WORKSPACE_NO_EXEC:-0}" = "1" ]; then
  echo ""
  echo "Codex workspace preparation complete."
  exit 0
fi

echo ""
echo "Launching Codex workspace..."
exec codex
