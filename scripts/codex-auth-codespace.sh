#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "WARNING: codex is not installed or not on PATH."
  exit 0
fi

if codex login status >/dev/null 2>&1; then
  echo "Codex is already authenticated."
  exit 0
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "WARNING: OPENAI_API_KEY is not set."
  echo "Add it in GitHub: Settings -> Codespaces -> Secrets."
  echo "Hands-free Codex auth in Codespaces requires API-key auth via Codespaces secrets."
  exit 0
fi

echo "Authenticating Codex with OPENAI_API_KEY from Codespaces secrets..."
printf "%s" "$OPENAI_API_KEY" | codex login --with-api-key
echo "Codex authentication complete."
