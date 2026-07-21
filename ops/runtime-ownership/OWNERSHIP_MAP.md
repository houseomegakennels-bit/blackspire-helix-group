# Least-privileged runtime ownership map (blocker #2) — REVIEW ONLY, NOT PROVISIONED

Reviewed plan for the durable production runtime's non-root user and the ownership/permissions
of the release and persistent-state layout. **Nothing here is created or applied by any
repository change.** No user/group is created, no `chown`/`chmod` runs on live paths. Applying
this requires separate blocker #2 approval.

## Verified current host state (read-only, 2026-07-21)

- No `blackspire` user or group exists (`getent passwd/group blackspire` → absent).
- No `/opt/blackspire-command` release root exists yet. `/opt/blackspire` is the root-owned
  git checkout.
- The current running Command service is exposed on 8787 via `docker-proxy` (container
  runtime); the durable production runtime planned here is a **non-root systemd service**
  running `npm run start:production`, distinct from that container.
- The default release root in code (`packages/shared/security.js`) is `/opt/blackspire-command`
  (overridable via `BLACKSPIRE_RELEASE_ROOT`).

## Intended runtime identity

- **User:** `blackspire` — system account, no login shell (`/usr/sbin/nologin`), no password.
- **Group:** `blackspire` (primary).
- The service's `verifyVpsRuntime`/`verify-environment.sh` gates require: not root,
  `BLACKSPIRE_RUNTIME_USER=blackspire` matching the effective user, and the persistent state
  directories writable by **and owned by** this uid.

## Ownership and permission map

Layout rooted at `/opt/blackspire-command` (the code default). "runtime" = `blackspire`.

| Path | Owner:Group | Mode | Rationale |
|---|---|---|---|
| `/opt/blackspire-command` | `root:blackspire` | `0755` | Top dir; runtime traverses/reads, cannot modify. |
| `/opt/blackspire-command/releases/` | `root:blackspire` | `0755` | Parent of immutable releases; only deploy tooling (root) writes. |
| `/opt/blackspire-command/releases/<sha>/` | `root:blackspire` | `0755` (files `u=rwX,go-w`) | **Immutable release.** Runtime reads/executes; never writes. Enforces that the running code cannot mutate itself. |
| `/opt/blackspire-command/current` | `root:blackspire` (symlink) | symlink | Points at the active release. Swapped atomically by deploy tooling as root; runtime only reads. Symlink ownership does not grant target write. |
| `/opt/blackspire-command/shared/` | `blackspire:blackspire` | `0750` | Persistent-state root; runtime-owned. |
| `/opt/blackspire-command/shared/database/` | `blackspire:blackspire` | `0700` | SQLite `command.sqlite` + WAL/SHM. Runtime read/write. This is the DB parent `verifyVpsRuntime` checks. |
| `/opt/blackspire-command/shared/evidence/` | `blackspire:blackspire` | `0700` | Durable sanitized evidence/audit. Runtime read/write. |
| `/opt/blackspire-command/shared/backups/` | `blackspire:blackspire` | `0700` | `scripts/backup.js` default destination; SHA-256 sidecars. Runtime/backup read/write. |
| `/opt/blackspire-command/shared/logs/` | `blackspire:blackspire` | `0750` | Optional file logs. See "Logging" below — journald is preferred and needs no app-writable dir. |
| `/etc/blackspire/` | `root:blackspire` | `0750` | Config dir. |
| `/etc/blackspire/command.env` | `root:blackspire` | `0640` | **Secrets** (`COMMAND_ADMIN_TOKEN`, `SESSION_SECRET`, ...). Group-readable by runtime only; never world-readable; never committed to Git. |
| `/etc/systemd/system/blackspire-command.service` | `root:root` | `0644` | Unit file; only root manages. |

### Directories that MUST remain root-owned (runtime must NOT own or write)

- `/opt/blackspire-command/releases/*` and `current` (immutability boundary).
- `/etc/systemd/system/blackspire-command.service` and all systemd paths.
- `/var/lib/docker/containers/*` (the log-rotation target in `ops/blackspire-command-logrotate.conf`
  is owned by the Docker daemon / root; logrotate runs as root).
- `/etc/blackspire/command.env` is `root:blackspire 0640` — owned by root, only *readable* by
  the runtime group, never writable by the runtime.

### Config that must not be broadly readable

- `/etc/blackspire/command.env` → `0640 root:blackspire` (no world bits). Contains the admin
  token and session secret. Method/name only ever appears in memory docs — never a value.

## Logging

The app logs JSON to stdout. Preferred: capture via **systemd journald** (no app-writable log
dir, no broad permissions). The existing `ops/blackspire-command-logrotate.conf` rotates the
Docker container JSON logs (root-owned) and is unrelated to the non-root app's stdout. If the
operator instead wants file logs, use `shared/logs/` (`0750 blackspire:blackspire`).

## How deployment tooling gains only what it needs

- **Release create / switch / rollback** (`scripts/release-create.sh`, `release-switch.sh`,
  `release-rollback.sh`) run as **root** (or a dedicated `deploy` account with write to
  `/opt/blackspire-command/releases` and `current`, but **no** read on `command.env` and **no**
  write on `shared/`). They create `releases/<sha>` (`root:blackspire`) and swap the `current`
  symlink. The runtime user never needs write to releases or the symlink.
- **Backup** (`scripts/backup.js`) runs as `blackspire`; it writes only under
  `shared/backups/` and reads `shared/database/`.
- **Restore/migration** are never implicit. Restore rehearsal targets disposable paths only;
  migration requires `BLACKSPIRE_RUN_MIGRATIONS=true` under a separately approved controlled
  writer outage.
- The runtime (`blackspire`) needs **no** capabilities: port 8787 > 1024, so no
  `CAP_NET_BIND_SERVICE`; the unit template sets an empty capability set.

## Validation against repository tooling

| Tool | Requirement | This map satisfies it because |
|---|---|---|
| `verifyVpsRuntime` | uid ≠ 0; `BLACKSPIRE_RUNTIME_USER` == effective user; DB parent exists; each of `[dbParent, shared/database, shared/evidence, shared/backups]` writable **and** owned by uid; PORT 1–65535; bounded timeouts | Runtime is `blackspire` (non-root); the four persistent dirs are `blackspire`-owned `0700`; DB parent `shared/database` exists; `releases/*` is excluded from the writable set so its `root` ownership does not fail the gate. |
| `verify-environment.sh vps-production` | non-root; `BLACKSPIRE_RUNTIME_USER` ≠ root; DB parent exists; PORT valid; timeouts valid; no implicit migrations | Same identity and layout; env profile sets these. |
| `scripts/production-supervisor.js` | runs `verifyVpsRuntime` then spawns api/worker | Runs as `blackspire`; passes the gate before spawn. |
| `scripts/backup.js` | default dest = `shared/backups` (never inside a release, outside the DB dir); target not a symlink; 0700/0600 | `shared/database` → `defaultBackupDir` returns `shared/backups`; `shared/backups` is outside `shared/database` and not under `releases/`. |
| `scripts/restore.js` | disposable target, never the live DB; backup preserved | Rehearsal uses a disposable path under a temp dir; `shared/database/command.sqlite` is the protected live path. |
| `release-create.sh` / `release-rollback.sh` | archive to `releases/<sha>`; switch only the symlink | Run as root/deploy with write to `releases` + `current` only. |

Credential-free fixture verification of the `verifyVpsRuntime` expectations is in
`verify-ownership.sh` (run with a Node 22 runtime). It builds a throwaway directory tree
mirroring this map and asserts the gate passes, with no secrets and no live-path mutation.
