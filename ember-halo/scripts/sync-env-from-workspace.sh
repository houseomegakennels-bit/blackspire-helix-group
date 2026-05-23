#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/ember-halo"

target_file=".env"

write_env() {
  local key="$1"
  local default_value="${2:-}"
  local value="${!key:-$default_value}"
  printf "%s=%s\n" "$key" "$value" >> "$target_file"
}

if [ -f "$target_file" ] && [ "${1:-}" != "--force" ]; then
  echo "ember-halo/.env already exists. Use --force to overwrite it."
  exit 0
fi

: > "$target_file"

write_env "SUPABASE_URL" "https://kchtrvfcixnimvxxctkj.supabase.co"
write_env "SUPABASE_SERVICE_ROLE_KEY"
write_env "SUPABASE_ANON_KEY"
write_env "SUPABASE_JWT_SECRET"
write_env "ANTHROPIC_API_KEY"
write_env "STRIPE_SECRET_KEY"
write_env "STRIPE_PUBLISHABLE_KEY"
write_env "STRIPE_WEBHOOK_SECRET"
write_env "N8N_WEBHOOK_BASE_URL" "https://cpearson0312.app.n8n.cloud/webhook"
write_env "TWILIO_ACCOUNT_SID"
write_env "TWILIO_AUTH_TOKEN"
write_env "TWILIO_PHONE_NUMBER" "${TWILIO_FROM_NUMBER:-}"
write_env "APP_URL" "http://localhost:3010"
write_env "NODE_ENV" "development"
write_env "PORT" "3010"
write_env "FIRST_ADMIN_EMAIL"

echo "Wrote ember-halo/.env from current workspace environment."
