#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

declare -a EXAMPLE_FILES=()
[ -f ".env.example" ] && EXAMPLE_FILES+=(".env.example")
[ -f "frontend/.env.example" ] && EXAMPLE_FILES+=("frontend/.env.example")

if [ "${#EXAMPLE_FILES[@]}" -eq 0 ]; then
  echo "No env example files found. Skipping environment check."
  exit 0
fi

missing=0
declare -A SEEN_KEYS=()

check_example_file() {
  local file="$1"
  while IFS= read -r line; do
    case "$line" in
      ""|\#*) continue ;;
    esac

    key="${line%%=*}"
    if [ -n "${SEEN_KEYS[$key]:-}" ]; then
      continue
    fi
    SEEN_KEYS[$key]=1

    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL)
        if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ -z "${SUPABASE_URL:-}" ]; then
          echo "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL for fallback)"
          missing=1
        fi
        ;;
      NEXT_PUBLIC_SUPABASE_ANON_KEY)
        if [ -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] && [ -z "${SUPABASE_ANON_KEY:-}" ]; then
          echo "Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY for fallback)"
          missing=1
        fi
        ;;
      *)
        if [ -z "${!key:-}" ]; then
          echo "Missing required environment variable: $key"
          missing=1
        fi
        ;;
    esac
  done < "$file"
}

for example_file in "${EXAMPLE_FILES[@]}"; do
  check_example_file "$example_file"
done

if [ "$missing" -eq 1 ]; then
  echo ""
  echo "Add these as GitHub Codespaces secrets for this repository or export them before bootstrap."
  exit 1
fi

echo "Required environment variables are present."
