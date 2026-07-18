#!/usr/bin/env bash
set -euo pipefail

mode="${1:-${BLACKSPIRE_ENVIRONMENT:-development}}"
minimum_node="22.5.0"

fail() { printf 'environment verification failed: %s\n' "$1" >&2; exit 1; }
has_value() { [[ -n "${!1:-}" ]]; }

node_version="$(node --version 2>/dev/null | sed 's/^v//' || true)"
[[ -n "$node_version" ]] || fail "Node.js is unavailable"
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<5))process.exit(1)" || fail "Node.js ${minimum_node} or newer is required"

provider="${BLACKSPIRE_PROVIDER_MODE:-manual}"
case "$provider" in manual|mock|codex|openai|anthropic|claudeCode) ;; *) fail "provider mode is invalid" ;; esac

case "$mode" in
  development)
    [[ "${BLACKSPIRE_STATE_OWNER:-development}" != "vps-production" ]] || fail "development cannot own production state"
    [[ "$provider" == "manual" || "$provider" == "mock" ]] || fail "development provider must be manual or mock"
    ;;
  codespace)
    [[ "${CODESPACES:-false}" == "true" ]] || fail "Codespaces environment marker is required"
    for key in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET OPENAI_API_KEY ANTHROPIC_API_KEY CODEX_API_KEY; do
      has_value "$key" && fail "Codespaces cannot load production or provider credentials"
    done
    [[ "$provider" == "manual" || "$provider" == "mock" ]] || fail "Codespaces provider must be manual or mock"
    [[ "${BLACKSPIRE_STATE_OWNER:-codespace-disposable}" != "vps-production" ]] || fail "Codespaces cannot own production state"
    ;;
  iphone-test)
    access_code="${UNIFIED_TEST_ACCESS_CODE:-}"
    [[ "${UNIFIED_IPHONE_TEST_MODE:-}" == "true" ]] || fail "iPhone test mode flag is required"
    [[ "${NODE_ENV:-}" == "test" ]] || fail "iPhone test requires NODE_ENV=test"
    [[ "${HERMES_TEST_PROVIDER:-}" == "mock" && "${TELEGRAM_MODE:-}" == "mock" ]] || fail "iPhone test requires mock Hermes and mock Telegram"
    [[ "$provider" == "mock" ]] || fail "iPhone test provider mode must be mock"
    [[ "${BLACKSPIRE_DB_PATH:-}" == /tmp/* ]] || fail "iPhone test database must be disposable"
    [[ ${#access_code} -ge 12 ]] || fail "iPhone test access code is missing"
    for key in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET OPENAI_API_KEY ANTHROPIC_API_KEY CODEX_API_KEY GH_TOKEN GITHUB_TOKEN; do
      has_value "$key" && fail "iPhone test cannot inherit credentials"
    done
    ;;
  vps-production)
    [[ "${NODE_ENV:-}" == "production" ]] || fail "production requires NODE_ENV=production"
    [[ "${BLACKSPIRE_STATE_OWNER:-}" == "vps-production" ]] || fail "production state owner must be vps-production"
    [[ -n "${BLACKSPIRE_DB_PATH:-}" && "${BLACKSPIRE_DB_PATH}" != /tmp/* ]] || fail "production requires persistent database storage"
    [[ "${UNIFIED_IPHONE_TEST_MODE:-false}" != "true" && "${TELEGRAM_MODE:-}" != "mock" ]] || fail "production cannot enable test mode or mock Telegram"
    [[ "$provider" != "mock" ]] || fail "production cannot use the mock provider"
    [[ -n "${COMMAND_ADMIN_TOKEN:-}" && -n "${SESSION_SECRET:-}" ]] || fail "production authentication is not configured"
    ;;
  *) fail "unknown environment profile" ;;
esac

printf 'BLACKSPIRE ENVIRONMENT OK: mode=%s node=%s provider=%s\n' "$mode" "$node_version" "$provider"
