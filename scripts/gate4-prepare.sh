#!/usr/bin/env bash
set -euo pipefail

# Gate 4 preparation checker.
#
# PREPARATION ONLY. This script never authorizes Gate 4 and never activates production. It has no
# mutating mode: it does not write /etc/blackspire/command.env, does not seed a workspace checkout,
# does not create or switch the `current` symlink, does not create secrets or credentials, does not
# touch nginx, TLS, DNS, firewall, Telegram, providers, databases, or releases, and never starts,
# enables, restarts, or reloads any unit. Everything it does is a read or a stat. It is therefore
# trivially idempotent and safe to rerun at any time, including on an unprepared host.
#
# It answers exactly one question: which Gate 4 prerequisites are already satisfied on this host,
# and which operator inputs and approvals are still outstanding. `--plan` additionally prints the
# exact command sequence the operator would run, without running any of it.
#
# Fail-closed: any unmet prerequisite, missing required operator value, or unverifiable condition
# makes the run exit non-zero. A prerequisite is never reported satisfied on the strength of an
# absent check; conditions this script cannot verify from the host are reported MANUAL and count as
# outstanding, because a preparation report that quietly downgrades unknowns to "ready" is exactly
# how an activation gets attempted against an unprepared host.

usage() {
  cat >&2 <<'USAGE'
usage: gate4-prepare.sh [--check|--validate-only|--plan|--dry-run|--json]

  --check, --validate-only   (default) validate prerequisites, read-only
  --plan, --dry-run          print the operator command sequence, run nothing
  --json                     machine-readable findings

Required operator input:
  BLACKSPIRE_GATE4_APPROVED_SHA   the full 40-character commit SHA approved for production

This script never authorizes Gate 4 and never activates production.
USAGE
}

mode=check
case "${1:-}" in
  ''|--check|--validate-only) mode=check ;;
  --plan|--dry-run) mode=plan ;;
  --json) mode=json ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

# Every host path is overridable so the contract can be exercised against disposable fixtures. The
# defaults are the reviewed production locations, and an override only ever changes what is read.
release_root="${BLACKSPIRE_RELEASE_ROOT:-/opt/blackspire-command}"
release_root="${release_root%/}"
env_file="${BLACKSPIRE_PRODUCTION_ENV_FILE:-/etc/blackspire/command.env}"
api_env_file="${BLACKSPIRE_PRODUCTION_API_ENV_FILE:-/etc/blackspire/command-api.env}"
api_unit_name="${BLACKSPIRE_GATE4_API_UNIT_NAME:-${BLACKSPIRE_GATE4_UNIT_NAME:-blackspire-command.service}}"
worker_unit_name="${BLACKSPIRE_GATE4_WORKER_UNIT_NAME:-blackspire-command-worker.service}"
target_name="${BLACKSPIRE_GATE4_TARGET_NAME:-blackspire-command.target}"
api_unit_file="${BLACKSPIRE_GATE4_API_UNIT_FILE:-${BLACKSPIRE_GATE4_UNIT_FILE:-/etc/systemd/system/${api_unit_name}}}"
worker_unit_file="${BLACKSPIRE_GATE4_WORKER_UNIT_FILE:-/etc/systemd/system/${worker_unit_name}}"
target_file="${BLACKSPIRE_GATE4_TARGET_FILE:-/etc/systemd/system/${target_name}}"
systemctl_bin="${BLACKSPIRE_GATE4_SYSTEMCTL:-systemctl}"
logrotate_file="${BLACKSPIRE_GATE4_LOGROTATE_FILE:-/etc/logrotate.d/blackspire-command}"
runtime_user="${BLACKSPIRE_GATE4_RUNTIME_USER:-blackspire}"
api_user="${BLACKSPIRE_GATE4_API_USER:-blackspire-api}"
worker_user="${BLACKSPIRE_GATE4_WORKER_USER:-blackspire-worker}"
approved_sha="${BLACKSPIRE_GATE4_APPROVED_SHA:-}"
unit_backup_dir="${BLACKSPIRE_GATE4_UNIT_BACKUP_DIR:-/var/backups/blackspire-command/gate4-${approved_sha:-unapproved}}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Findings accumulate as three parallel arrays rather than one delimited string, so a message
# containing a separator can never split a record or forge an extra finding.
finding_ids=()
finding_states=()
finding_details=()
ready=1

# READY   the prerequisite is satisfied and was verified here.
# PENDING an operator input or action is still outstanding; expected on an unprepared host.
# MANUAL  this script cannot verify it from the host; an operator must attest to it.
# FAILED  something is actively wrong and must be corrected before Gate 4 is requested.
record() {
  finding_ids+=("$1")
  finding_states+=("$2")
  finding_details+=("$3")
  [[ "$2" == READY ]] || ready=0
}

# --- Operator input -------------------------------------------------------------------------

if [[ -z "$approved_sha" ]]; then
  record approved-sha PENDING 'BLACKSPIRE_GATE4_APPROVED_SHA is required; the operator must name the exact approved commit'
elif [[ ! "$approved_sha" =~ ^[0-9a-f]{40}$ ]]; then
  record approved-sha FAILED 'BLACKSPIRE_GATE4_APPROVED_SHA must be a full 40-character lowercase commit SHA'
  approved_sha=""
else
  record approved-sha READY 'operator supplied an approved commit SHA'
fi

# --- Source contract ------------------------------------------------------------------------

# Reuse the existing preflight rather than restating its 21 source checks here; two copies of the
# same contract would eventually disagree, and the preflight is the reviewed one.
# shellcheck source=scripts/lib/node-bin.sh
. "$repo_root/scripts/lib/node-bin.sh"
if node_bin="$(blackspire_resolve_node 2>/dev/null)"; then
  if preflight_output="$("$node_bin" "$repo_root/scripts/production-preflight-check.js" 2>&1)"; then
    record source-preflight READY "$(printf '%s' "$preflight_output" | tail -n 1)"
  else
    record source-preflight FAILED "$(printf '%s' "$preflight_output" | tail -n 1)"
  fi
else
  record source-preflight FAILED 'the reviewed Node interpreter could not be resolved; the preflight cannot be run'
fi

# --- Production must still be inactive ------------------------------------------------------

# An assertion, not an action. If production is already running, this preparation run is being
# performed against an activated host and its conclusions would be misleading.
if command -v "$systemctl_bin" >/dev/null 2>&1; then
  active_units=""
  inactive_states=""
  for checked_unit in "$api_unit_name" "$worker_unit_name" "$target_name"; do
    active_state="$("$systemctl_bin" show "$checked_unit" -p ActiveState --value 2>/dev/null || echo unknown)"
    unit_state="$("$systemctl_bin" show "$checked_unit" -p UnitFileState --value 2>/dev/null || echo unknown)"
    if [[ "$unit_state" == enabled || "$unit_state" == enabled-runtime || "$unit_state" == linked || "$unit_state" == linked-runtime ]]; then
      active_units+="${active_units:+; }$checked_unit=$active_state/$unit_state (must be disabled before preparation)"
    elif [[ "$active_state" == inactive || "$active_state" == failed ]]; then
      inactive_states+="${inactive_states:+; }$checked_unit=$active_state/${unit_state:-unknown}"
    else
      active_units+="${active_units:+; }$checked_unit=$active_state"
    fi
  done
  if [[ -z "$active_units" ]]; then
    record production-inactive READY "API, worker, and target are inactive ($inactive_states)"
  else
    record production-inactive FAILED "production must be inactive during preparation but found $active_units"
  fi
else
  record production-inactive MANUAL 'systemctl is unavailable here; confirm the API, worker, and target are inactive and disabled on the host'
fi

check_installed_unit() {
  local finding_id="$1" installed_file="$2" template_file="$3" description="$4"
  if [[ -f "$installed_file" && ! -L "$installed_file" ]]; then
    if cmp -s "$installed_file" "$repo_root/ops/runtime-ownership/$template_file"; then
      record "$finding_id" READY "the installed $description is byte-identical to the reviewed template"
    else
      record "$finding_id" FAILED "the installed $description differs from the reviewed template; reinstall it before Gate 4"
    fi
  else
    record "$finding_id" PENDING "the reviewed $description is not installed as a regular file"
  fi
}

check_installed_unit installed-api-unit "$api_unit_file" blackspire-command.service 'API unit'
check_installed_unit installed-worker-unit "$worker_unit_file" blackspire-command-worker.service 'worker unit'
check_installed_unit installed-runtime-target "$target_file" blackspire-command.target 'runtime target'

# --- Operator-supplied environment file ------------------------------------------------------

# Values are never read, printed, or logged. Only presence, ownership, mode, and which keys exist.
if [[ -e "$env_file" || -L "$env_file" ]]; then
  if [[ -L "$env_file" ]]; then
    record env-file FAILED 'the production environment file must not be a symlink'
  elif [[ ! -f "$env_file" ]]; then
    record env-file FAILED 'the production environment file must be a regular file'
  else
    env_mode="$(stat -c '%a' -- "$env_file")"
    env_owner="$(stat -c '%U:%G' -- "$env_file")"
    if [[ "$env_mode" == 640 && "$env_owner" == "root:$runtime_user" ]]; then
      record env-file-permissions READY "environment file is $env_owner mode $env_mode"
    else
      record env-file-permissions FAILED "environment file must be root:$runtime_user mode 0640 (found $env_owner mode $env_mode)"
    fi
    missing_keys=""
    for key in NODE_ENV BLACKSPIRE_RUNTIME_MODE BLACKSPIRE_STATE_OWNER BLACKSPIRE_RUNTIME_USER \
      BLACKSPIRE_STARTUP_TIMEOUT_SECONDS BLACKSPIRE_HEALTH_TIMEOUT_SECONDS BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT BLACKSPIRE_PROVIDER_MODE \
      BLACKSPIRE_HERMES_MODE TELEGRAM_MODE BLACKSPIRE_DB_PATH BLACKSPIRE_DATA_DIR \
      BLACKSPIRE_BACKUP_DIR BLACKSPIRE_WORKSPACE_ROOT BIND_HOST PORT PUBLIC_BASE_URL \
      SECURE_COOKIES; do
      grep -qE "^[[:space:]]*${key}=" -- "$env_file" || missing_keys+="${missing_keys:+, }$key"
    done
    if [[ -z "$missing_keys" ]]; then
      record env-file-keys READY 'environment file declares every required production key'
    else
      record env-file-keys FAILED "environment file is missing required keys: $missing_keys"
    fi
    misplaced_auth_keys=""
    for key in COMMAND_ADMIN_PASSWORD_HASH COMMAND_ADMIN_TOKEN SESSION_SECRET; do
      grep -qE "^[[:space:]]*${key}=." -- "$env_file" && misplaced_auth_keys+="${misplaced_auth_keys:+, }$key"
    done
    if [[ -z "$misplaced_auth_keys" ]]; then
      record env-file-auth-isolated READY 'shared environment file carries no API authentication credentials'
    else
      record env-file-auth-isolated FAILED "shared environment file must not expose API authentication credentials to the worker: $misplaced_auth_keys"
    fi
    # The approved profile is credential-free for providers and Telegram. verify-environment.sh
    # refuses these at ExecStartPre too; catching them here means the operator finds out during
    # preparation rather than from a failed start.
    forbidden_keys=""
    for key in OPENAI_API_KEY ANTHROPIC_API_KEY CODEX_API_KEY CODEX_API_ENDPOINT \
      TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
      grep -qE "^[[:space:]]*${key}=." -- "$env_file" && forbidden_keys+="${forbidden_keys:+, }$key"
    done
    if [[ -z "$forbidden_keys" ]]; then
      record env-file-credential-free READY 'environment file carries no provider or Telegram credentials'
    else
      record env-file-credential-free FAILED "the approved profile forbids: $forbidden_keys"
    fi
  fi
else
  record env-file PENDING "$env_file does not exist; the operator must create it from scripts/production-profile.env.example"
fi

if [[ -e "$api_env_file" || -L "$api_env_file" ]]; then
  if [[ -L "$api_env_file" || ! -f "$api_env_file" ]]; then
    record api-env-file FAILED 'the API-only environment file must be a regular non-symlink file'
  else
    api_env_mode="$(stat -c '%a' -- "$api_env_file")"
    api_env_owner="$(stat -c '%U:%G' -- "$api_env_file")"
    if [[ "$api_env_mode" == 640 && "$api_env_owner" == "root:$api_user" ]]; then
      record api-env-file-permissions READY "API-only environment file is $api_env_owner mode $api_env_mode"
    else
      record api-env-file-permissions FAILED "API-only environment file must be root:$api_user mode 0640 (found $api_env_owner mode $api_env_mode)"
    fi
    missing_api_keys=""
    for key in COMMAND_ADMIN_PASSWORD_HASH SESSION_SECRET ALLOW_BEARER_AUTH COMMAND_ADMIN_TOKEN; do
      grep -qE "^[[:space:]]*${key}=" -- "$api_env_file" || missing_api_keys+="${missing_api_keys:+, }$key"
    done
    if [[ -z "$missing_api_keys" ]]; then
      record api-env-file-keys READY 'API-only environment file declares every authentication key'
    else
      record api-env-file-keys FAILED "API-only environment file is missing required declarations: $missing_api_keys"
    fi
  fi
else
  record api-env-file PENDING "$api_env_file does not exist; the operator must create it from scripts/production-api.env.example"
fi

# --- Workspace checkout -----------------------------------------------------------------------

# Resolved from the operator's own file when it exists, so preparation validates the same value
# ExecStartPre will. Falls back to the reviewed example's value only to report where it must go.
workspace_root=""
if [[ -f "$env_file" && ! -L "$env_file" ]]; then
  workspace_root="$(sed -nE 's/^[[:space:]]*BLACKSPIRE_WORKSPACE_ROOT=(.*)$/\1/p' -- "$env_file" | tail -n 1)"
  workspace_root="${workspace_root%\"}"; workspace_root="${workspace_root#\"}"
  workspace_root="${workspace_root%\'}"; workspace_root="${workspace_root#\'}"
fi
workspace_source='the operator environment file'
if [[ -z "$workspace_root" ]]; then
  workspace_root="$(sed -nE 's/^BLACKSPIRE_WORKSPACE_ROOT=(.*)$/\1/p' "$repo_root/scripts/production-profile.env.example" | tail -n 1)"
  workspace_source='the reviewed profile example'
fi

if [[ -z "$workspace_root" ]]; then
  record workspace-root FAILED 'no workspace root is declared anywhere; the production profile must set BLACKSPIRE_WORKSPACE_ROOT'
elif [[ ! -e "$workspace_root" && ! -L "$workspace_root" ]]; then
  record workspace-root PENDING "$workspace_root (from $workspace_source) is not seeded yet"
else
  # These mirror scripts/verify-environment.sh vps-production exactly. Preparation must not be
  # laxer than ExecStartPre, or it would report ready for a root the unit then refuses.
  workspace_detail=""
  [[ "$workspace_root" = /* ]] || workspace_detail+='must be absolute; '
  [[ ! -L "$workspace_root" ]] || workspace_detail+='must not be a symlink; '
  [[ -d "$workspace_root" ]] || workspace_detail+='must be a directory; '
  { [[ -r "$workspace_root" ]] && [[ -x "$workspace_root" ]]; } || workspace_detail+='must be readable and traversable; '
  [[ -w "$workspace_root" ]] || workspace_detail+='must be writable by the runtime user; '
  [[ -e "$workspace_root/.git" && ! -L "$workspace_root/.git" ]] || workspace_detail+='must be a git checkout; '
  for required_entry in package.json apps packages; do
    [[ -e "$workspace_root/$required_entry" ]] || workspace_detail+="missing $required_entry; "
  done
  # The runbook forbids a workspace root inside a release: releases are immutable and read-only to
  # the runtime account, which is the whole reason this setting exists.
  case "$workspace_root/" in
    "$release_root/releases/"*|"$release_root/current/"*|"$release_root/current/") workspace_detail+='must not live inside a release; ' ;;
  esac
  if [[ -z "$workspace_detail" ]]; then
    record workspace-root READY "$workspace_root is a usable writable checkout"
  else
    record workspace-root FAILED "$workspace_root: ${workspace_detail%; }"
  fi
fi

# --- Release and rollback target ---------------------------------------------------------------

if [[ -n "$approved_sha" ]]; then
  approved_release="$release_root/releases/$approved_sha"
  if [[ -d "$approved_release" && ! -L "$approved_release" && -f "$approved_release/.release-complete" ]]; then
    record approved-release READY "the approved release is built and complete at $approved_release"
  else
    record approved-release PENDING "no completed release for the approved SHA at $approved_release; build it with scripts/release-create.sh"
  fi
else
  record approved-release PENDING 'the approved release cannot be checked until the operator names the approved SHA'
fi

# Blocker 5: an exact known-good rollback target must exist and be recorded before activation.
rollback_candidates=0
if [[ -d "$release_root/releases" ]]; then
  for candidate in "$release_root"/releases/*/; do
    [[ -d "$candidate" && -f "$candidate/.release-complete" ]] || continue
    [[ -n "$approved_sha" && "$candidate" == "$release_root/releases/$approved_sha/" ]] && continue
    rollback_candidates=$((rollback_candidates + 1))
  done
fi
if (( rollback_candidates > 0 )); then
  record rollback-target READY "$rollback_candidates completed release(s) available as a rollback target"
else
  record rollback-target PENDING 'no completed release other than the approved one is available to roll back to'
fi

# The `current` symlink is the unit's WorkingDirectory. Reporting only; switching it is activation.
current_link="$release_root/current"
if [[ -L "$current_link" ]]; then
  current_target="$(readlink -f -- "$current_link" || true)"
  if [[ -n "$approved_sha" && "$current_target" == "$release_root/releases/$approved_sha" ]]; then
    record current-symlink READY "current points at the approved release"
  else
    record current-symlink PENDING "current points at ${current_target:-an unresolvable target}; switching it is an activation step"
  fi
elif [[ -e "$current_link" ]]; then
  record current-symlink FAILED "$current_link exists but is not a symlink"
else
  record current-symlink PENDING "$current_link does not exist; creating it is an activation step, not preparation"
fi

# --- Host-side blockers -------------------------------------------------------------------------

# Blocker 2: least-privileged non-root runtime ownership.
runtime_identity_detail=""
for checked_user in "$api_user" "$worker_user"; do
  if ! id -u "$checked_user" >/dev/null 2>&1; then runtime_identity_detail+="${runtime_identity_detail:+; }$checked_user is absent"
  elif [[ "$(id -u "$checked_user")" == 0 ]]; then runtime_identity_detail+="${runtime_identity_detail:+; }$checked_user is root"
  elif ! id -Gn "$checked_user" | tr ' ' '\n' | grep -qx "$runtime_user"; then runtime_identity_detail+="${runtime_identity_detail:+; }$checked_user is not in shared group $runtime_user"
  fi
done
if [[ -z "$runtime_identity_detail" && "$(id -u "$api_user")" != "$(id -u "$worker_user")" ]]; then
  record runtime-ownership READY "distinct non-root API and worker accounts share only group $runtime_user"
elif [[ -z "$runtime_identity_detail" ]]; then
  record runtime-ownership FAILED 'API and worker runtime accounts must have distinct UIDs'
else
  record runtime-ownership PENDING "$runtime_identity_detail"
fi

# Blocker 4: a real production backup must exist before activation touches production data.
backup_dir="$release_root/shared/backups"
if [[ -d "$backup_dir" ]] && compgen -G "$backup_dir/*.sqlite" >/dev/null 2>&1; then
  record production-backup READY 'a production backup snapshot is present under shared/backups'
else
  record production-backup PENDING "no backup snapshot found under $backup_dir; take one with scripts/backup.js before activation"
fi

# Blocker 3: log rotation must be installed and alert-tested.
if [[ -f "$logrotate_file" ]] && cmp -s "$logrotate_file" "$repo_root/ops/blackspire-command-logrotate.conf"; then
  record log-rotation READY "the exact reviewed log rotation policy is installed at $logrotate_file"
elif [[ -f "$logrotate_file" ]]; then
  record log-rotation FAILED "log rotation at $logrotate_file differs from the reviewed service-isolated policy"
else
  record log-rotation PENDING "log rotation is not installed at $logrotate_file (template: ops/blackspire-command-logrotate.conf)"
fi

# Blockers 1 and 3 (alert testing) cannot be established from file presence alone. Reverse proxy,
# TLS, and alert delivery are operator attestations; this script must not manufacture evidence for
# them from a config file it happens to find.
record reverse-proxy-tls MANUAL 'operator must attest that the approved reverse proxy and TLS are installed and verified'
record monitoring-alerts MANUAL 'operator must attest that monitoring alerts were installed and alert-tested'
record migration-rehearsal MANUAL 'operator must attest that the approved production backup and migration rehearsal is complete'

# --- Authorization boundary ---------------------------------------------------------------------

# Deliberately terminal and never satisfiable here. Gate 4 authorization is an operator decision
# recorded outside this script; no environment variable read by this script can grant it.
record gate4-authorization PENDING 'Gate 4 is NOT authorized; authorization is a separate explicit operator approval and is never granted by this script'

# --- Output ---------------------------------------------------------------------------------------

emit_plan() {
  cat <<PLAN
BLACKSPIRE GATE 4 — OPERATOR COMMAND PLAN (nothing below is executed by this script)

PREPARATION (safe, reversible, no activation)
  Run the following preparation commands in one fail-fast shell:
       set -euo pipefail
  1. Provision distinct no-login $api_user and $worker_user accounts in shared group $runtime_user,
     then create the shared and API-only environment files. Each file is created with mode 0640 in
     one step, so it is never briefly world-readable:
       test ! -e $env_file && test ! -L $env_file
       install -o root -g $runtime_user -m 0640 \\
         $repo_root/scripts/production-profile.env.example $env_file
       test ! -e $api_env_file && test ! -L $api_env_file
       install -o root -g $api_user -m 0640 \\
         $repo_root/scripts/production-api.env.example $api_env_file
       # then edit $env_file and set:
       #   PUBLIC_BASE_URL   the real production URL
       # and edit $api_env_file to set COMMAND_ADMIN_PASSWORD_HASH and SESSION_SECRET, generated by
       # the operator and never by tooling. Never put those values in the shared $env_file.
       # confirm PORT is still free first:
       #   bash scripts/with-node.sh scripts/select-production-port.js
  2. Seed the workspace checkout (never inside releases/, never the release root):
       test ! -e $workspace_root && test ! -L $workspace_root
       install -d -o $api_user -g $runtime_user -m 0770 $workspace_root
       git clone --no-hardlinks <approved-repository-url> $workspace_root
       git -C $workspace_root checkout --detach \${BLACKSPIRE_GATE4_APPROVED_SHA}
       chown -R $api_user:$runtime_user $workspace_root
       chmod -R g+rwX,o-rwx $workspace_root
  3. Build the immutable release for the approved SHA (does not activate it):
       bash scripts/release-create.sh \${BLACKSPIRE_GATE4_APPROVED_SHA}
  4. Take the production backup before anything touches production data. Route it through the
     pinned interpreter: scripts/backup.js imports node:sqlite, which this host's PATH node (18.x)
     does not have.
       npm run db:backup -- $release_root/shared/backups
  5. Install the reviewed API, worker, and coordination target definitions, then reload systemd.
     The checker above fails closed if an installed definition differs; inspect that difference
     before replacing any existing file:
       install -d -o root -g root -m 0700 "\$(dirname -- $unit_backup_dir)"
       mkdir -m 0700 -- $unit_backup_dir || { echo 'unit snapshot already exists; refusing overwrite' >&2; exit 1; }
       chown root:root -- $unit_backup_dir
       for unit_path in $api_unit_file $worker_unit_file $target_file; do
         unit_base="\$(basename -- "\$unit_path")"
         if test -f "\$unit_path" && test ! -L "\$unit_path"; then
           install -o root -g root -m 0600 "\$unit_path" "$unit_backup_dir/\$unit_base"
         elif test ! -e "\$unit_path" && test ! -L "\$unit_path"; then
           install -o root -g root -m 0600 /dev/null "$unit_backup_dir/\$unit_base.absent"
         else
           echo "refusing unsafe installed unit path: \$unit_path" >&2; exit 1
         fi
       done
       install -o root -g root -m 0600 /dev/null $unit_backup_dir/.complete
       install -o root -g root -m 0644 \\
         $repo_root/ops/runtime-ownership/blackspire-command.service $api_unit_file
       install -o root -g root -m 0644 \\
         $repo_root/ops/runtime-ownership/blackspire-command-worker.service $worker_unit_file
       install -o root -g root -m 0644 \\
         $repo_root/ops/runtime-ownership/blackspire-command.target $target_file
       systemctl daemon-reload
  6. Install the reviewed log-rotation policy without replacing an existing policy:
       test ! -e $logrotate_file && test ! -L $logrotate_file
       install -o root -g root -m 0644 \\
         $repo_root/ops/blackspire-command-logrotate.conf $logrotate_file
  7. Re-run this checker to review the remaining prerequisites. It deliberately stays nonzero
     while authorization and activation remain beyond the boundary:
       BLACKSPIRE_GATE4_APPROVED_SHA=\${BLACKSPIRE_GATE4_APPROVED_SHA} \\
         bash scripts/gate4-prepare.sh --validate-only

VALIDATION (read-only, proves preparation is correct)
  # Runs the same profile ExecStartPre will, as the runtime account. Sourcing keeps the values out
  # of argv and the process table; never pass them as command arguments.
  sudo -u $api_user bash -c \\
    'set -a; . $env_file; . $api_env_file; set +a; exec bash $repo_root/scripts/verify-environment.sh vps-production api'
  sudo -u $worker_user bash -c \\
    'set -a; . $env_file; set +a; exec bash $repo_root/scripts/verify-environment.sh vps-production worker'
  npm run production:preflight:host
  BLACKSPIRE_GATE4_APPROVED_SHA=\${BLACKSPIRE_GATE4_APPROVED_SHA} \\
    bash $repo_root/scripts/gate4-prepare.sh --validate-only
  systemctl show $target_name $api_unit_name $worker_unit_name -p ActiveState -p UnitFileState -p MainPID

ROLLBACK OF PREPARATION (safe; production was never started)
  BLACKSPIRE_GATE4_APPROVED_SHA=\${BLACKSPIRE_GATE4_APPROVED_SHA} \
    bash $repo_root/scripts/gate4-rollback-preparation.sh
  # The helper validates all evidence/destinations, compensates failed unit restore/reload, and
  # never deletes immutable releases.

--- AUTHORIZATION BOUNDARY -------------------------------------------------------------------
Everything above is preparation. Everything below is Gate 4 activation and requires a separate,
explicit, bounded operator approval. This script will never run any of it, and neither will any
automation acting on this report.

ACTIVATION (operator only, after Gate 4 is authorized)
  set -euo pipefail
  rollback_sha=<known-good-sha>
  activation_failed() {
    trap - ERR
    set +e
    systemctl disable $target_name
    systemctl stop $target_name
    stop_rc=\$?
    if (( stop_rc == 0 )); then
      bash scripts/release-rollback.sh "\$rollback_sha"
    else
      echo 'activation rollback refused release switch because target shutdown failed' >&2
    fi
    exit 1
  }
  trap activation_failed ERR
  bash scripts/release-switch.sh \${BLACKSPIRE_GATE4_APPROVED_SHA}
  systemctl start $target_name
  # The canonical waiter polls both services, health/readiness, and the worker systemd invocation.
  bash scripts/wait-production-ready.sh http://127.0.0.1:<reviewed-port> $api_unit_name $worker_unit_name 60 1
  systemctl enable $target_name        # persist boot activation only after health and readiness pass
  trap - ERR

ACTIVATION ROLLBACK (operator only)
  systemctl stop $target_name
  systemctl disable $target_name
  bash scripts/release-rollback.sh <known-good-sha>
PLAN
}

case "$mode" in
  json)
    printf '{"ready":%s,"findings":[' "$([[ $ready == 1 ]] && echo true || echo false)"
    for i in "${!finding_ids[@]}"; do
      [[ $i -gt 0 ]] && printf ','
      printf '{"id":"%s","state":"%s","detail":"%s"}' \
        "${finding_ids[$i]}" "${finding_states[$i]}" "${finding_details[$i]//\"/\\\"}"
    done
    printf '],"gate4Authorized":false,"productionActivated":false}\n'
    ;;
  plan)
    emit_plan
    ;;
  *)
    for i in "${!finding_ids[@]}"; do
      printf '%-7s %-24s %s\n' "${finding_states[$i]}" "${finding_ids[$i]}" "${finding_details[$i]}"
    done
    printf '\nBLACKSPIRE GATE 4 PREPARATION: ready=%s (Gate 4 NOT authorized; production NOT activated)\n' \
      "$([[ $ready == 1 ]] && echo true || echo false)"
    printf 'Run with --plan for the exact operator command sequence. This script changed nothing.\n'
    ;;
esac

[[ $ready == 1 ]] || exit 1
exit 0
