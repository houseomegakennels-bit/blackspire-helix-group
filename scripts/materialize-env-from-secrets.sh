#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FORCE_WRITE=0
[ "${1:-}" = "--force" ] && FORCE_WRITE=1

write_env_file() {
  local example_file="$1"
  local target_file="$2"

  if [ ! -f "$example_file" ]; then
    return 0
  fi

  if [ -f "$target_file" ] && [ "$FORCE_WRITE" -ne 1 ]; then
    echo "$target_file already exists. Use --force to overwrite it."
    return 0
  fi

  mkdir -p "$(dirname "$target_file")"
  local tmp_file
  tmp_file="$(mktemp)"

  while IFS= read -r line; do
    case "$line" in
      ""|\#*)
        echo "$line" >> "$tmp_file"
        continue
        ;;
    esac

    key="${line%%=*}"
    value="${!key:-}"

    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL)
        [ -z "$value" ] && value="${SUPABASE_URL:-}"
        ;;
      NEXT_PUBLIC_SUPABASE_ANON_KEY)
        [ -z "$value" ] && value="${SUPABASE_ANON_KEY:-}"
        ;;
    esac

    printf "%s=%s\n" "$key" "$value" >> "$tmp_file"
  done < "$example_file"

  mv "$tmp_file" "$target_file"
  echo "Wrote $target_file from current environment variables."
}

write_env_file ".env.example" ".env"
write_env_file "frontend/.env.example" "frontend/.env.local"
