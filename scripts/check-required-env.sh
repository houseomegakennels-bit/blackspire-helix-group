#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ ! -f .env.example ]; then
  echo "No .env.example found. Skipping environment check."
  exit 0
fi

missing=0

while IFS= read -r line; do
  case "$line" in
    ""|\#*) continue ;;
  esac

  key="${line%%=*}"
  if [ -z "${!key:-}" ]; then
    echo "Missing required environment variable: $key"
    missing=1
  fi
done < .env.example

if [ "$missing" -eq 1 ]; then
  echo ""
  echo "Add these as GitHub Codespaces secrets for this repository or create a local .env."
  exit 1
fi

echo "Required environment variables are present."
