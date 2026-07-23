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
    [[ "${BLACKSPIRE_RUNTIME_MODE:-}" == "production" ]] || fail "production requires BLACKSPIRE_RUNTIME_MODE=production"
    [[ "${BLACKSPIRE_STATE_OWNER:-}" == "vps-production" ]] || fail "production state owner must be vps-production"
    [[ -n "${BLACKSPIRE_DB_PATH:-}" && "${BLACKSPIRE_DB_PATH}" != /tmp/* ]] || fail "production requires persistent database storage"
    [[ "${UNIFIED_IPHONE_TEST_MODE:-false}" != "true" && "${TELEGRAM_MODE:-dry-run}" != "mock" ]] || fail "production cannot enable test mode or mock Telegram"
    [[ "$provider" == "manual" ]] || fail "approved production profile requires manual provider mode"
    [[ "${BLACKSPIRE_HERMES_MODE:-restricted}" != "mock" ]] || fail "production cannot use mock Hermes"
    for key in OPENAI_API_KEY ANTHROPIC_API_KEY CODEX_API_KEY CODEX_API_ENDPOINT TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
      has_value "$key" && fail "production profile forbids $key"
    done
    [[ "${TELEGRAM_MODE:-dry-run}" == "dry-run" ]] || fail "real Telegram must remain disconnected"
    [[ -n "${COMMAND_ADMIN_TOKEN:-}" && -n "${SESSION_SECRET:-}" ]] || fail "production authentication is not configured"
    [[ "${BLACKSPIRE_RUN_MIGRATIONS:-false}" != "true" ]] || fail "migrations must not run implicitly; approve them separately"
    # Loopback-only bind boundary. The production application port is private; the reverse
    # proxy is the only public surface, so a wildcard or non-loopback host is rejected here
    # before systemd starts the supervisor.
    bind_host="${BIND_HOST:-}"
    [[ -n "$bind_host" ]] || fail "BIND_HOST must be set to 127.0.0.1 for production"
    case "$bind_host" in
      127.0.0.1) ;;
      0.0.0.0|::|'*') fail "BIND_HOST must not be a wildcard address; production binds loopback only" ;;
      *) fail "BIND_HOST must be exactly 127.0.0.1; non-loopback addresses are rejected" ;;
    esac
    # Explicit port only — no default and no fallback to 8787.
    port="${PORT:-}"
    [[ -n "$port" ]] || fail "PORT must be set explicitly for production; there is no default"
    [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || fail "PORT must be an explicit decimal integer"
    (( port <= 65535 )) || fail "PORT must be no greater than 65535"
    (( port >= 1024 )) || fail "PORT must be an unprivileged port (>= 1024)"
    (( port != 8787 )) || fail "PORT 8787 is reserved by the existing API/worker listener"
    (( port != 8788 )) || fail "PORT 8788 is reserved by restricted staging"
    # Read-only conflict detection: refuse an occupied port without touching its owner.
    if command -v ss >/dev/null 2>&1; then
      if ss -lnt 2>/dev/null | awk -v p=":$port" 'NR>1 && $4 ~ (p "$") { found=1 } END { exit found ? 0 : 1 }'; then
        fail "PORT $port is already in use; refusing to start"
      fi
    fi
    [[ -d "$(dirname -- "${BLACKSPIRE_DB_PATH}")" ]] || fail "persistent database parent directory does not exist"
    startup="${BLACKSPIRE_STARTUP_TIMEOUT_SECONDS:-}"
    { [[ "$startup" =~ ^[0-9]+$ ]] && (( startup >= 1 && startup <= 600 )); } || fail "startup timeout must be a positive integer no greater than 600"
    health="${BLACKSPIRE_HEALTH_TIMEOUT_SECONDS:-}"
    { [[ "$health" =~ ^[0-9]+$ ]] && (( health >= 1 && health <= 120 )); } || fail "health timeout must be a positive integer no greater than 120"
    [[ -n "${BLACKSPIRE_RUNTIME_USER:-}" && "${BLACKSPIRE_RUNTIME_USER}" != "root" ]] || fail "BLACKSPIRE_RUNTIME_USER must be a non-root runtime user"
    [[ "$(id -u)" -ne 0 ]] || fail "production runtime must not run as root"
    ;;
  *) fail "unknown environment profile" ;;
esac

printf 'BLACKSPIRE ENVIRONMENT OK: mode=%s node=%s provider=%s\n' "$mode" "$node_version" "$provider"
