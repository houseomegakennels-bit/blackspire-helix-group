#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

target_file=".env"

if [ -f "$target_file" ] && [ "${1:-}" != "--force" ]; then
  echo ".env already exists. Use --force to overwrite it."
  exit 0
fi

if [ ! -f .env.example ]; then
  echo "No .env.example found."
  exit 1
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

while IFS= read -r line; do
  case "$line" in
    ""|\#*)
      echo "$line" >> "$tmp_file"
      continue
      ;;
  esac

  key="${line%%=*}"
  value="${!key:-}"
  printf "%s=%s\n" "$key" "$value" >> "$tmp_file"
done < .env.example

mv "$tmp_file" "$target_file"
echo "Wrote .env from current environment variables."
