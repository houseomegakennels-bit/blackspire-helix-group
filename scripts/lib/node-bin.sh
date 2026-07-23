#!/usr/bin/env bash
# Canonical Node interpreter resolution for every production path.
#
# systemd's manager PATH is /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin and does
# NOT include /opt/nodejs, so a bare `node` in any unit-invoked helper silently resolves to the
# distribution's Node 18. The control plane requires node:sqlite (packages/task-engine/db.js,
# scripts/backup.js, scripts/restore.js), which does not exist before Node 22.5, so that
# resolution is never correct for the durable production runtime.
#
# Every production startup, preflight, supervisor, migration, backup, monitoring, ownership, and
# helper path resolves through this one function so they cannot disagree about which binary runs.
#
# Two environment variables are recognised, and both are documented here because either can change
# the outcome:
#
#   BLACKSPIRE_NODE_BIN            an explicit interpreter, for tests and CI images.
#   BLACKSPIRE_REVIEWED_NODE_BIN   the reviewed durable-VPS interpreter path itself.
#
# Under BLACKSPIRE_STATE_OWNER=vps-production neither may point somewhere other than the reviewed
# interpreter, and PATH lookup is refused outright. That matters because /etc/blackspire/command.env
# is operator-managed and outside git: without this rule an EnvironmentFile entry could make the
# ExecStartPre helpers validate one binary while ExecStart runs another, which is the same
# "verify a different binary than you run" defect this module exists to prevent.
#
# Resolution order:
#   1. BLACKSPIRE_NODE_BIN, when set (rejected under vps-production unless it is the reviewed path).
#   2. The reviewed durable-VPS interpreter, when present and executable.
#   3. `node` from PATH - development and CI images only, never under vps-production.
#
# Whatever is chosen must report a well-formed version on stdout and satisfy the node:sqlite floor,
# so an empty, malformed, or non-Node binary such as /bin/true fails closed rather than being
# accepted on exit status alone.

BLACKSPIRE_REVIEWED_NODE_BIN="${BLACKSPIRE_REVIEWED_NODE_BIN:-/opt/nodejs/node-v22.23.1-linux-x64/bin/node}"
BLACKSPIRE_EXPECTED_NODE_VERSION="${BLACKSPIRE_EXPECTED_NODE_VERSION:-22.23.1}"

# Print the resolved interpreter on stdout, or fail closed with a message on stderr.
blackspire_resolve_node() {
  local candidate="" owner="${BLACKSPIRE_STATE_OWNER:-}" reported="" major minor
  owner="${owner//[[:space:]]/}"

  # The production rule binds wherever the reviewed interpreter is actually installed, which is the
  # durable VPS. There, it must be used: no substitution and no PATH lookup. Where it is genuinely
  # absent -- CI runners and development images, which are not production hosts -- the ordinary
  # resolution applies, and the floor check below still rejects an interpreter that cannot run the
  # product. Binding the rule to the interpreter's presence rather than to the mode argument alone
  # keeps the guarantee exactly where it matters without breaking environments that never had it.
  local reviewed_present=0
  [[ -x "$BLACKSPIRE_REVIEWED_NODE_BIN" ]] && reviewed_present=1
  local enforce_reviewed=0
  [[ "$owner" == "vps-production" && "$reviewed_present" -eq 1 ]] && enforce_reviewed=1

  if [[ -n "${BLACKSPIRE_NODE_BIN:-}" ]]; then
    if [[ "$enforce_reviewed" -eq 1 && "$BLACKSPIRE_NODE_BIN" != "$BLACKSPIRE_REVIEWED_NODE_BIN" ]]; then
      echo 'BLACKSPIRE_NODE_BIN may not substitute a different interpreter under vps-production' >&2
      return 1
    fi
    candidate="$BLACKSPIRE_NODE_BIN"
  elif [[ "$reviewed_present" -eq 1 ]]; then
    candidate="$BLACKSPIRE_REVIEWED_NODE_BIN"
  elif [[ "$owner" == "vps-production" && -n "${BLACKSPIRE_REQUIRE_REVIEWED_NODE:-}" ]]; then
    echo 'the reviewed production interpreter is unavailable; PATH lookup is refused' >&2
    return 1
  else
    candidate="$(command -v node 2>/dev/null || true)"
  fi

  [[ -n "$candidate" ]] || { echo 'node interpreter is unavailable' >&2; return 1; }
  [[ -f "$candidate" && -x "$candidate" ]] || { echo 'resolved node interpreter is not an executable file' >&2; return 1; }

  # Capture stdout rather than trusting the exit status: /bin/true exits 0 and is not an interpreter.
  reported="$("$candidate" --version 2>/dev/null || true)"
  [[ "$reported" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || {
    echo 'resolved interpreter did not report a well-formed Node version' >&2; return 1; }
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"

  if (( major < 22 || (major == 22 && minor < 5) )); then
    echo "resolved interpreter ${reported} is below the node:sqlite floor of 22.5" >&2
    return 1
  fi

  # The exact-version requirement applies where the reviewed interpreter is installed, for the same
  # reason: off the durable VPS there is no reviewed build to match against.
  if [[ "$enforce_reviewed" -eq 1 && "${reported#v}" != "$BLACKSPIRE_EXPECTED_NODE_VERSION" ]]; then
    echo "production requires Node ${BLACKSPIRE_EXPECTED_NODE_VERSION}; resolved ${reported}" >&2
    return 1
  fi

  printf '%s\n' "$candidate"
}
