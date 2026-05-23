#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/ember-halo"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

required=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ANON_KEY
  SUPABASE_JWT_SECRET
  ANTHROPIC_API_KEY
  STRIPE_SECRET_KEY
  STRIPE_PUBLISHABLE_KEY
  STRIPE_WEBHOOK_SECRET
  N8N_WEBHOOK_BASE_URL
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PHONE_NUMBER
  APP_URL
)

missing=0
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ] || [[ "${!key:-}" =~ placeholder|your_|\\.\\.\\. ]]; then
    echo "Missing or placeholder value: $key"
    missing=1
  fi
done

if [ "$missing" -eq 1 ]; then
  echo ""
  echo "Add missing values to GitHub Codespaces secrets or ember-halo/.env."
  exit 1
fi

echo "Ember Halo environment variables are present."
