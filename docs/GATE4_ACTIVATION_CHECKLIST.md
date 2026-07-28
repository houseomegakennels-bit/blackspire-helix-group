# Gate 4 Activation Checklist

Gate 4 is production activation. **It is not authorized.** This document prepares for it and defines
the boundary; it does not grant it. Nothing in this repository may start, enable, restart, or
activate production, switch the `current` symlink, create credentials, or write
`/etc/blackspire/command.env`. Those are operator actions taken under a separate, explicit, bounded
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
| `COMMAND_ADMIN_TOKEN` | `/etc/blackspire/command.env` | Operator-generated secret |
| `SESSION_SECRET` | `/etc/blackspire/command.env` | Operator-generated secret |
| `PUBLIC_BASE_URL` | `/etc/blackspire/command.env` | The real production URL; the example ships a `.invalid` placeholder |
| `PORT` | `/etc/blackspire/command.env` | Reviewed default 8789; confirm it is still free before use |
| Approved repository URL | workspace seeding | The clone source for the Hermes workspace checkout |

## Prerequisites

Verified automatically by the checker:

1. **Source contract** — `npm run production:preflight` reports `ok=true source=21/21 deployment=2/2`.
2. **Production inactive** — the unit is `inactive`/`disabled` throughout preparation.
3. **Installed unit** — `/etc/systemd/system/blackspire-command.service` is byte-identical to
   `ops/runtime-ownership/blackspire-command.service`.
4. **Environment file** — exists as a regular file, `root:blackspire` mode `0640`, declaring every
   required key and carrying no provider or Telegram credentials. The reviewed profile pins
   `BLACKSPIRE_RUNTIME_USER=blackspire`, startup timeout `30`, and health timeout `5`, matching the
   requirements enforced by both `ExecStartPre` and `verifyVpsRuntime`. Values are never printed.
5. **Workspace checkout** — `BLACKSPIRE_WORKSPACE_ROOT` is absolute, a non-symlinked directory, a git
   checkout with `package.json`, `apps/`, and `packages/`, readable, traversable, and writable by the
   runtime account, and outside `releases/` and `current`. The checker applies exactly the rules
   `scripts/verify-environment.sh vps-production` enforces at `ExecStartPre`, so preparation cannot
   report ready for a root the unit would then refuse.
6. **Approved release** — a completed immutable release exists for the approved SHA.
7. **Rollback target** — at least one other completed release is available to roll back to.
8. **Runtime ownership** — the `blackspire` account exists and is non-root.
9. **Production backup** — a snapshot exists under `shared/backups`.
10. **Log rotation** — installed at `/etc/logrotate.d/blackspire-command`.

Operator attestation required (the host cannot prove these):

11. **Reverse proxy and TLS** installed and verified.
12. **Monitoring alerts** installed and alert-tested.
13. **Backup and migration rehearsal** completed under separate approval.

## Preparation commands

Safe, reversible, and non-activating. `scripts/gate4-prepare.sh --plan` prints these with the real
paths already substituted.

```sh
# 1. Environment file, created with its final ownership and mode in one step
test ! -e /etc/blackspire/command.env && test ! -L /etc/blackspire/command.env
install -o root -g blackspire -m 0640 \
  scripts/production-profile.env.example /etc/blackspire/command.env
# then edit it and supply PUBLIC_BASE_URL, COMMAND_ADMIN_TOKEN, SESSION_SECRET
bash scripts/with-node.sh scripts/select-production-port.js   # confirm PORT is free

# 2. Workspace checkout — never inside releases/, never the release root
test ! -e /opt/blackspire-command/shared/workspace && \
  test ! -L /opt/blackspire-command/shared/workspace
install -d -o blackspire -g blackspire -m 0750 /opt/blackspire-command/shared/workspace
git clone --no-hardlinks <approved-repository-url> /opt/blackspire-command/shared/workspace
git -C /opt/blackspire-command/shared/workspace checkout --detach <approved-sha>
chown -R blackspire:blackspire /opt/blackspire-command/shared/workspace

# 3. Immutable release for the approved SHA (builds it; does not activate it)
bash scripts/release-create.sh <approved-sha>

# 4. Production backup, through the pinned interpreter
npm run db:backup -- /opt/blackspire-command/shared/backups

# 5. Reviewed log rotation, installed without replacing an existing policy
test ! -e /etc/logrotate.d/blackspire-command && \
  test ! -L /etc/logrotate.d/blackspire-command
install -o root -g root -m 0644 \
  ops/blackspire-command-logrotate.conf /etc/logrotate.d/blackspire-command
```

`/opt/blackspire-command/shared/workspace` is the reviewed location because the unit runs under
`ProtectSystem=strict` with `ReadWritePaths=/opt/blackspire-command/shared`: that tree is the only
path the runtime account can write. A workspace anywhere else is read-only to production no matter
what its file permissions say.

## Validation

```sh
sudo -u blackspire bash -c \
  'set -a; . /etc/blackspire/command.env; set +a; exec bash scripts/verify-environment.sh vps-production'
npm run production:preflight:host
BLACKSPIRE_GATE4_APPROVED_SHA=<sha> bash scripts/gate4-prepare.sh --validate-only
systemctl show blackspire-command.service -p ActiveState -p UnitFileState -p MainPID
```

Source the environment file rather than passing values as arguments; arguments are visible in the
process table.

## Rollback of preparation

Preparation never started production, so undoing it is just removing what it created. Releases are
immutable and are never deleted as part of a rollback.

```sh
rm -f /etc/blackspire/command.env
rm -rf /opt/blackspire-command/shared/workspace
rm -f /etc/logrotate.d/blackspire-command
```

## Authorization boundary

Everything above is preparation and may be performed and reverted freely. Everything below is
**Gate 4 activation**. It requires a separate, explicit, bounded operator approval, and no
automation — including `scripts/gate4-prepare.sh` — may perform any of it.

```sh
# OPERATOR ONLY, AFTER GATE 4 IS AUTHORIZED
bash scripts/release-switch.sh <approved-sha>      # switches the production current symlink
systemctl start blackspire-command.service
systemctl enable blackspire-command.service        # only after a clean start is verified
BIND_HOST=127.0.0.1 PORT=<reviewed-port> bash scripts/health-check.sh

# ACTIVATION ROLLBACK, OPERATOR ONLY
systemctl stop blackspire-command.service
systemctl disable blackspire-command.service
bash scripts/release-rollback.sh <known-good-sha>
```

The first command in that block is the boundary: switching `current` is the first action that
changes what production would run.
