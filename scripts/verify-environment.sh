#!/usr/bin/env bash
set -euo pipefail

mode="${1:-${BLACKSPIRE_ENVIRONMENT:-development}}"
minimum_node="22.5.0"

fail() { printf 'environment verification failed: %s\n' "$1" >&2; exit 1; }
has_value() { [[ -n "${!1:-}" ]]; }

# Resolve the interpreter deterministically rather than through PATH. This runs as the systemd
# ExecStartPre, where PATH would otherwise resolve the distribution's Node 18 and this check would
# validate a different interpreter than ExecStart actually runs.
# shellcheck source=scripts/lib/node-bin.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/node-bin.sh"
node_bin="$(blackspire_resolve_node)" || fail "Node.js ${minimum_node} or newer is required"
node_version="$("$node_bin" --version 2>/dev/null | sed 's/^v//' || true)"
[[ -n "$node_version" ]] || fail "Node.js is unavailable"

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
    # Real provider execution is an explicit operator authorization, never a default and never
    # inferred from the presence of a credential. Absent (or 'disabled') this stays the approved
    # no-external-provider profile: manual provider mode, and no provider credential may even be
    # loaded into the process. Set to exactly 'enabled', the whole execution configuration must be
    # coherent here, so a half-configured opt-in is refused before systemd starts the supervisor
    # rather than failing on every task after it is already serving.
    execution="${BLACKSPIRE_PRODUCTION_EXECUTION:-disabled}"
    case "$execution" in
      enabled|disabled) ;;
      *) fail "BLACKSPIRE_PRODUCTION_EXECUTION must be exactly 'enabled' or 'disabled'" ;;
    esac
    # Telegram credentials are outside the provider-execution decision and stay forbidden either way.
    for key in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
      has_value "$key" && fail "production profile forbids $key"
    done
    if [[ "$execution" == "enabled" ]]; then
      [[ "$provider" != "manual" && "$provider" != "mock" ]] || fail "production execution requires a real provider mode, not $provider"
      [[ "${BLACKSPIRE_HERMES_MODE:-}" == "production" ]] || fail "production execution requires BLACKSPIRE_HERMES_MODE=production"
      allowlist="${BLACKSPIRE_PRODUCTION_PROVIDERS:-}"
      allowlist="${allowlist//[[:space:]]/}"
      [[ -n "$allowlist" ]] || fail "production execution requires a non-empty BLACKSPIRE_PRODUCTION_PROVIDERS allowlist"
      allowed_openai=false; allowed_anthropic=false; allowed_codex=false
      IFS=',' read -r -a allowlist_entries <<< "$allowlist"
      for entry in "${allowlist_entries[@]}"; do
        case "$entry" in
          "") fail "BLACKSPIRE_PRODUCTION_PROVIDERS allowlist contains an empty entry" ;;
          mock) fail "BLACKSPIRE_PRODUCTION_PROVIDERS allowlist must not contain mock" ;;
          openai) allowed_openai=true; has_value OPENAI_API_KEY || fail "allowlisted provider openai requires OPENAI_API_KEY" ;;
          anthropic) allowed_anthropic=true; has_value ANTHROPIC_API_KEY || fail "allowlisted provider anthropic requires ANTHROPIC_API_KEY" ;;
          codex) allowed_codex=true; { has_value CODEX_API_KEY && has_value CODEX_API_ENDPOINT; } || fail "allowlisted provider codex requires CODEX_API_KEY and CODEX_API_ENDPOINT" ;;
          # The Claude Code CLI authenticates itself; there is no credential to inject here.
          claudeCode) ;;
          *) fail "BLACKSPIRE_PRODUCTION_PROVIDERS allowlist contains an unknown provider: $entry" ;;
        esac
      done
      # A credential that no allowlisted provider can use must not be present at all: loading it
      # would widen the blast radius of the process without any configuration authorizing its use.
      [[ "$allowed_openai" == true ]] || ! has_value OPENAI_API_KEY || fail "production execution forbids OPENAI_API_KEY: openai is not in the allowlist"
      [[ "$allowed_anthropic" == true ]] || ! has_value ANTHROPIC_API_KEY || fail "production execution forbids ANTHROPIC_API_KEY: anthropic is not in the allowlist"
      [[ "$allowed_codex" == true ]] || { ! has_value CODEX_API_KEY && ! has_value CODEX_API_ENDPOINT; } || fail "production execution forbids CODEX_API_KEY: codex is not in the allowlist"
      # The provider mode is the request the runtime makes; it has to be one the server allows.
      [[ ",$allowlist," == *",$provider,"* ]] || fail "BLACKSPIRE_PROVIDER_MODE $provider is not in the server allowlist"
    else
      [[ "$provider" == "manual" ]] || fail "approved production profile requires manual provider mode"
      [[ "${BLACKSPIRE_HERMES_MODE:-restricted}" != "mock" ]] || fail "production cannot use mock Hermes"
      for key in OPENAI_API_KEY ANTHROPIC_API_KEY CODEX_API_KEY CODEX_API_ENDPOINT; do
        has_value "$key" && fail "production profile forbids $key"
      done
    fi
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
    # Hermes performs git and build work with workspace.root_path as its cwd. Under the immutable
    # release the process cwd is /opt/blackspire-command/current, which is read-only to the runtime
    # account, so production must name a real writable checkout. packages/shared/workspace-root.js
    # applies the same path rules at runtime (absolute, not a symlink, existing, a directory, a git
    # checkout with a non-symlinked .git), so validating them here means ExecStartPre cannot pass a
    # configuration the supervisor's children would then refuse, which would otherwise surface as a
    # Restart=on-failure loop up to StartLimitBurst instead of a clean refusal. The production rules
    # here are deliberately stricter than the resolver's, never looser: the resolver treats an absent
    # variable as the historical "." development default, while production requires it explicitly
    # because "." is the read-only release; and production additionally requires the workspace to be
    # writable and to carry the application files a task actually needs.
    workspace_root="${BLACKSPIRE_WORKSPACE_ROOT-}"
    workspace_root="${workspace_root#"${workspace_root%%[![:space:]]*}"}"
    workspace_root="${workspace_root%"${workspace_root##*[![:space:]]}"}"
    [[ -n "$workspace_root" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT must be set for production; there is no default"
    [[ "$workspace_root" = /* ]] || fail "BLACKSPIRE_WORKSPACE_ROOT must be an absolute path"
    # Symlink before existence/type: a symlinked root is refused rather than followed, so the
    # effective working directory cannot be repointed outside the reviewed configuration.
    [[ ! -L "$workspace_root" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT must not be a symlink"
    [[ -e "$workspace_root" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT does not exist"
    [[ -d "$workspace_root" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT is not a directory"
    # Read and traverse are both required: the runtime user must be able to list and enter the tree.
    { [[ -r "$workspace_root" ]] && [[ -x "$workspace_root" ]]; } || fail "BLACKSPIRE_WORKSPACE_ROOT is not readable and traversable by the runtime user"
    # Writable too, and this is the check that catches the sandbox rather than the permission bits.
    # ExecStartPre runs inside the same ProtectSystem=strict namespace as ExecStart, where only
    # ReadWritePaths=/opt/blackspire-command/shared is writable; access(2) reports EROFS for a
    # read-only mount, so a root outside that tree is refused here instead of failing mid-task when
    # Hermes first tries to branch or commit.
    [[ -w "$workspace_root" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT is not writable by the runtime user"
    # A checkout, not just any directory: Hermes branches, applies edits, inspects, and commits here.
    # .git is a directory in an ordinary clone and a pointer file in a linked worktree; both are valid.
    [[ -e "$workspace_root/.git" && ! -L "$workspace_root/.git" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT is not a git checkout"
    # The seeded workspace's build commands are npm scripts and its allowed paths include apps and
    # packages, so a checkout missing them cannot execute a task even though it is a valid git tree.
    missing_workspace_entries=""
    for required_entry in package.json apps packages; do
      [[ -e "$workspace_root/$required_entry" ]] || missing_workspace_entries+="${missing_workspace_entries:+, }$required_entry"
    done
    [[ -z "$missing_workspace_entries" ]] || fail "BLACKSPIRE_WORKSPACE_ROOT is missing required application files: $missing_workspace_entries"
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
