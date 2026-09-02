# Gate 4 Activation Checklist

Gate 4 is production activation. **It is not authorized.** This document prepares for it and defines
the boundary; it does not grant it. Nothing in this repository may start, enable, restart, or
activate production, switch the `current` symlink, create credentials, or write
`/etc/blackspire/command.env` or `/etc/blackspire/command-api.env`. Those are operator actions taken under a separate, explicit, bounded
approval.

The machine-checkable part of this checklist is `scripts/gate4-prepare.sh`. It is read-only, has no
mutating mode, and is safe to rerun at any time:

```sh
BLACKSPIRE_GATE4_APPROVED_SHA=<full-40-char-sha> bash scripts/gate4-prepare.sh          # validate
BLACKSPIRE_GATE4_APPROVED_SHA=<full-40-char-sha> bash scripts/gate4-prepare.sh --plan   # command plan
BLACKSPIRE_GATE4_APPROVED_SHA=<full-40-char-sha> bash scripts/gate4-prepare.sh --json   # machine-readable
BLACKSPIRE_GATE4_APPROVED_SHA=<full-40-char-sha> bash scripts/gate4-prepare.sh --validate-only
BLACKSPIRE_GATE4_APPROVED_SHA=<full-40-char-sha> bash scripts/gate4-prepare.sh --dry-run
```

It exits non-zero while anything is outstanding. A `MANUAL` finding is not a pass — it is a
condition the host cannot prove, which an operator must attest to.

## Operator values still required

None of these may be generated, invented, or defaulted by tooling.

| Value | Where it goes | Notes |
| --- | --- | --- |
| Approved commit SHA | `BLACKSPIRE_GATE4_APPROVED_SHA` | Full 40-character lowercase SHA, reviewed and merged |
| `COMMAND_ADMIN_PASSWORD_HASH` | `/etc/blackspire/command-api.env` | API-only; generated interactively with `npm run auth:hash-password` |
| `COMMAND_ADMIN_TOKEN` | `/etc/blackspire/command-api.env` | API-only machine credential; required only if bearer auth is explicitly enabled |
| `SESSION_SECRET` | `/etc/blackspire/command-api.env` | API-only operator-generated secret |
| `PUBLIC_BASE_URL` | `/etc/blackspire/command.env` | The real production URL; the example ships a `.invalid` placeholder |
| `PORT` | `/etc/blackspire/command.env` | Reviewed default 8789; confirm it is still free before use |
| Approved repository URL | workspace seeding | The clone source for the Hermes workspace checkout |

## Prerequisites

Verified automatically by the checker:

1. **Source contract** — `npm run production:preflight` reports every source check ready.
2. **Production inactive and disabled** — the API unit, worker unit, and coordination target are
   inactive throughout preparation and none is enabled or linked. This refuses a legacy
   `multi-user.target.wants` API link that could boot the API without its worker.
3. **Installed topology** — the installed `blackspire-command.service`,
   `blackspire-command-worker.service`, and `blackspire-command.target` are each byte-identical to
   their reviewed templates in `ops/runtime-ownership/`.
4. **Environment files** — shared `command.env` is `root:blackspire` mode `0640` and contains no
   authentication credential; API-only `command-api.env` is `root:blackspire-api` mode `0640`.
   The service units override the shared runtime-user value with their distinct role identities.
5. **Workspace checkout** — `BLACKSPIRE_WORKSPACE_ROOT` is absolute, a non-symlinked directory, a git
   checkout with `package.json`, `apps/`, and `packages/`, readable, traversable, and writable by the
   runtime account, and outside `releases/` and `current`. The checker applies exactly the rules
   `scripts/verify-environment.sh vps-production` enforces at `ExecStartPre`, so preparation cannot
   report ready for a root the unit would then refuse.
6. **Approved release** — a completed immutable release exists for the approved SHA.
7. **Rollback target** — at least one other completed release is available to roll back to.
8. **Runtime ownership** — distinct non-root, no-login `blackspire-api` and `blackspire-worker`
   accounts exist and share only the `blackspire` runtime group needed for durable state.
9. **Production backup** — a snapshot exists under `shared/backups`.
10. **Log rotation** — the installed `/etc/logrotate.d/blackspire-command` is byte-identical to the
    reviewed service-isolated policy; mere file presence is not readiness.

Operator attestation required (the host cannot prove these):

11. **Reverse proxy and TLS** installed and verified.
12. **Monitoring alerts** installed and alert-tested.
13. **Backup and migration rehearsal** completed under separate approval.

## Preparation commands

Non-activating. Reversible preparation steps are identified separately from the explicitly
authorized identity and metadata prerequisites, which the rollback helper does not undo.
`scripts/gate4-prepare.sh --plan` prints these with the real paths already substituted.

```sh
# Identity provisioning is a separately authorized host prerequisite and is not undone by the
# preparation rollback helper.
getent group blackspire >/dev/null || groupadd --system blackspire
provision_runtime_user() {
  user_name="$1"
  if id "$user_name" >/dev/null 2>&1; then
    test "$(id -u "$user_name")" -ne 0
    test "$(getent passwd "$user_name" | cut -d: -f7)" = /usr/sbin/nologin
  else
    useradd --system --user-group --no-create-home --shell /usr/sbin/nologin "$user_name"
  fi
  usermod --append --groups blackspire "$user_name"
  id -Gn "$user_name" | tr ' ' '\n' | grep -qx blackspire
}
provision_runtime_user blackspire-api
provision_runtime_user blackspire-worker
test "$(id -u blackspire-api)" != "$(id -u blackspire-worker)"

# 1. Shared and API-only environment files
set -euo pipefail
test ! -e /etc/blackspire/command.env && test ! -L /etc/blackspire/command.env
install -o root -g blackspire -m 0640 \
  scripts/production-profile.env.example /etc/blackspire/command.env
test ! -e /etc/blackspire/command-api.env && test ! -L /etc/blackspire/command-api.env
install -o root -g blackspire-api -m 0640 \
  scripts/production-api.env.example /etc/blackspire/command-api.env
# Set PUBLIC_BASE_URL in command.env. Set password hash and session secret only in command-api.env.
bash scripts/with-node.sh scripts/select-production-port.js   # confirm PORT is free

# 2. Workspace checkout — never inside releases/, never the release root
test ! -e /opt/blackspire-command/shared/workspace && \
  test ! -L /opt/blackspire-command/shared/workspace
install -d -o blackspire-api -g blackspire -m 2770 /opt/blackspire-command/shared/workspace
git clone --no-hardlinks <approved-repository-url> /opt/blackspire-command/shared/workspace
git -C /opt/blackspire-command/shared/workspace checkout --detach <approved-sha>
chown -R blackspire-api:blackspire /opt/blackspire-command/shared/workspace
find /opt/blackspire-command/shared/workspace -type d -exec chmod 2770 {} +
find /opt/blackspire-command/shared/workspace -type f -exec chmod g+rw,o-rwx {} +

# 3. Immutable release for the approved SHA (builds it; does not activate it)
BLACKSPIRE_STATE_OWNER=vps-production bash scripts/release-create.sh <approved-sha>

# 4. Production backup, through the pinned interpreter
npm run db:backup -- /opt/blackspire-command/shared/backups

# Separately authorize this metadata migration after the backup, while production is stopped.
# Preparation rollback does not restore accounts, ownership, or modes.
chown blackspire-api:blackspire /opt/blackspire-command/shared
chown -R blackspire-api:blackspire /opt/blackspire-command/shared/database \
  /opt/blackspire-command/shared/evidence /opt/blackspire-command/shared/backups \
  /opt/blackspire-command/shared/workspace
find /opt/blackspire-command/shared /opt/blackspire-command/shared/database \
  /opt/blackspire-command/shared/evidence /opt/blackspire-command/shared/backups \
  /opt/blackspire-command/shared/workspace -type d -exec chmod 2770 {} +
find /opt/blackspire-command/shared/database /opt/blackspire-command/shared/evidence \
  /opt/blackspire-command/shared/backups /opt/blackspire-command/shared/workspace \
  -type f -exec chmod g+rw,o-rwx {} +

# 5. Record the before-state of all three installed definitions, install the reviewed topology,
# and reload definitions only (this does not start or enable anything)
unit_backup_dir=/var/backups/blackspire-command/gate4-<approved-sha>
install -d -o root -g root -m 0700 "$(dirname -- "$unit_backup_dir")"
mkdir -m 0700 -- "$unit_backup_dir" || { echo 'snapshot exists; refusing overwrite' >&2; exit 1; }
chown root:root -- "$unit_backup_dir"
for unit_path in /etc/systemd/system/blackspire-command.service \
  /etc/systemd/system/blackspire-command-worker.service \
  /etc/systemd/system/blackspire-command.target; do
  unit_base="$(basename -- "$unit_path")"
  if test -f "$unit_path" && test ! -L "$unit_path"; then
    install -o root -g root -m 0600 "$unit_path" "$unit_backup_dir/$unit_base"
  elif test ! -e "$unit_path" && test ! -L "$unit_path"; then
    install -o root -g root -m 0600 /dev/null "$unit_backup_dir/$unit_base.absent"
  else
    echo "refusing unsafe installed unit path: $unit_path" >&2; exit 1
  fi
done
install -o root -g root -m 0600 /dev/null "$unit_backup_dir/.complete"
install -o root -g root -m 0644 ops/runtime-ownership/blackspire-command.service \
  /etc/systemd/system/blackspire-command.service
install -o root -g root -m 0644 ops/runtime-ownership/blackspire-command-worker.service \
  /etc/systemd/system/blackspire-command-worker.service
install -o root -g root -m 0644 ops/runtime-ownership/blackspire-command.target \
  /etc/systemd/system/blackspire-command.target
systemctl daemon-reload

# 6. Reviewed log rotation, installed without replacing an existing policy
test ! -e /etc/logrotate.d/blackspire-command && \
  test ! -L /etc/logrotate.d/blackspire-command
install -o root -g root -m 0644 \
  ops/blackspire-command-logrotate.conf /etc/logrotate.d/blackspire-command
cmp ops/blackspire-command-logrotate.conf /etc/logrotate.d/blackspire-command
logrotate --debug /etc/logrotate.d/blackspire-command
```

Before authorization, force one rotation against a disposable service log and verify the recreated
files are role-owned, group `blackspire`, and mode `0660`. See `docs/PRODUCTION_LOGGING_AND_RETENTION.md` for retention,
capacity, and `copytruncate` limitations.

`/opt/blackspire-command/shared/workspace` is the reviewed location because the unit runs under
`ProtectSystem=strict` with `ReadWritePaths=/opt/blackspire-command/shared`: that tree is the only
path the runtime account can write. A workspace anywhere else is read-only to production no matter
what its file permissions say.

## Validation

```sh
sudo -u blackspire-api bash -c \
  'set -a; . /etc/blackspire/command.env; . /etc/blackspire/command-api.env; set +a; BLACKSPIRE_RUNTIME_USER=blackspire-api exec bash scripts/verify-environment.sh vps-production api'
sudo -u blackspire-worker bash -c \
  'set -a; . /etc/blackspire/command.env; set +a; BLACKSPIRE_RUNTIME_USER=blackspire-worker exec bash scripts/verify-environment.sh vps-production worker'
npm run production:preflight:host
BLACKSPIRE_GATE4_APPROVED_SHA=<sha> bash scripts/gate4-prepare.sh --validate-only
systemctl show blackspire-command.target blackspire-command.service blackspire-command-worker.service \
  -p ActiveState -p UnitFileState -p MainPID
```

Source the environment file rather than passing values as arguments; arguments are visible in the
process table.

Run the test suite through the reviewed interpreter, not the host's PATH Node:

```sh
PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:$PATH bash scripts/with-node.sh scripts/run-tests.js
```

Plain `npm test` resolves this host's PATH Node (v18.19.1, no `node:sqlite`). The contained run then
aborts and reports ~31 failures — one real assertion plus a cascade of "missing completion" file
failures. That is an interpreter artifact, not a regression. The same cause makes
`tests/production-bind-boundary.test.js` fail one case off the pinned interpreter; it is 46/46 with
the interpreter above, and fails identically on `origin/main`.

## Rollback of preparation

Preparation never started production, so undoing it is just removing what it created. Releases are
immutable and are never deleted as part of a rollback.

```sh
BLACKSPIRE_GATE4_APPROVED_SHA=<approved-sha> bash scripts/gate4-rollback-preparation.sh
```

The helper validates the complete snapshot and every destination before mutation. It stages the
prepared unit definitions on the unit filesystem, restores every unit, and reloads systemd before
staging non-unit state for deletion. Any unit restore or daemon-reload failure compensates all
earlier unit changes back to the prepared state and exits nonzero.

## Authorization boundary

Everything above is preparation and may be performed and reverted freely. Everything below is
**Gate 4 activation**. It requires a separate, explicit, bounded operator approval, and no
automation — including `scripts/gate4-prepare.sh` — may perform any of it.

```sh
# OPERATOR ONLY, AFTER GATE 4 IS AUTHORIZED
set -euo pipefail
approved_sha=<approved-sha>
rollback_sha=<known-good-sha>
activation_failed() {
  trap - ERR
  set +e
  systemctl disable blackspire-command.target
  systemctl stop blackspire-command.target
  stop_rc=$?
  if (( stop_rc == 0 )); then
    bash scripts/release-rollback.sh "$rollback_sha"
  else
    echo 'activation rollback refused release switch because target shutdown failed' >&2
  fi
  exit 1
}
trap activation_failed ERR
bash scripts/release-switch.sh "$approved_sha"    # switches the production current symlink
systemctl start blackspire-command.target
bash scripts/wait-production-ready.sh http://127.0.0.1:<reviewed-port> \
  blackspire-command.service blackspire-command-worker.service 60 1
systemctl enable blackspire-command.target         # persist boot activation only after health/readiness pass
trap - ERR

# ACTIVATION ROLLBACK, OPERATOR ONLY
systemctl stop blackspire-command.target
systemctl disable blackspire-command.target
bash scripts/release-rollback.sh <known-good-sha>
```

The first command in that block is the boundary: switching `current` is the first action that
changes what production would run.
