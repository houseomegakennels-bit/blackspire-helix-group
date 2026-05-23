#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "codex is not installed or not on PATH."
  exit 1
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY is not set in this environment."
  echo "Add it as a GitHub Codespaces secret, then rebuild or restart the codespace."
  exit 1
fi

echo "Current Codex auth:"
codex login status || true

echo ""
echo "Switching Codex to API key auth..."
codex logout || true
printf "%s" "$OPENAI_API_KEY" | codex login --with-api-key

echo ""
echo "New Codex auth:"
codex login status
