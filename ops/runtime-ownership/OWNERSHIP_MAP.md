# Least-privileged runtime ownership map

This map defines the reviewed ownership/permissions contract for the durable production runtime
and the restricted staging release layout. Repository changes do not provision a production
runtime, user/group, or persistent production state. The staging infrastructure described below
does not establish production activation and remains separate from the disabled production unit.

## Verified current host state (read-only, 2026-07-22)

- The `blackspire` user and group exist for the restricted staging runtime.
- `/opt/blackspire-command` exists with completed release `releases/0a9affacaf13dd1b040c5d96eb112d979ab59444` and an unactivated failed candidate `releases/691973870e0048f273fa7e9251d7f78776e3612b`. The latter exposed the release-mode defect and must not be activated.
- `blackspire-command-staging.service` runs as `blackspire:blackspire` on loopback port 8788. The separate production `blackspire-command.service` is disabled and inactive; its environment file, current symlink, and production database are absent.
- The original Command surface on 8787 remains distinct and unchanged. The default release root in code is `/opt/blackspire-command` (overridable via `BLACKSPIRE_RELEASE_ROOT`).

## Intended runtime identity

- **API user:** `blackspire-api`; **worker user:** `blackspire-worker`. Both are distinct system
  accounts with no login shell or password.
- **Shared group:** `blackspire`. Persistent state is group-writable where both roles require it.
- The runtime gates require the declared role user to match the effective user and persistent state
  to be writable and owned by either that user or one of its groups.

## Ownership and permission map

Layout rooted at `/opt/blackspire-command` (the code default).

| Path | Owner:Group | Mode | Rationale |
|---|---|---|---|
| `/opt/blackspire-command` | `root:blackspire` | `0755` | Top dir; runtime traverses/reads, cannot modify. |
| `/opt/blackspire-command/releases/` | `root:blackspire` | `0755` | Parent of immutable releases; only deploy tooling (root) writes. |
| `/opt/blackspire-command/releases/<sha>/` | `root:blackspire` | directories `0755`; ordinary files `0644`; archived executables `0755` | **Immutable release.** Runtime traverses directories, reads files, and executes required entrypoints; it never writes. Enforces that running code cannot mutate itself. |
| `/opt/blackspire-command/current` | `root:blackspire` (symlink) | symlink | Points at the active release. Swapped atomically by deploy tooling as root; runtime only reads. Symlink ownership does not grant target write. |
| `/opt/blackspire-command/shared/` | `blackspire-api:blackspire` | `2770` | Setgid persistent-state root shared by the two isolated role identities. |
| `/opt/blackspire-command/shared/database/` | `blackspire-api:blackspire` | `2770` | SQLite `command.sqlite` + WAL/SHM; both roles require read/write. |
| `/opt/blackspire-command/shared/evidence/` | `blackspire-api:blackspire` | `2770` | Durable sanitized evidence/audit shared by both roles. |
| `/opt/blackspire-command/shared/backups/` | `blackspire-api:blackspire` | `2770` | Backup destination shared through the runtime group. |
| `/var/log/blackspire-command/` | role owner:`blackspire` | `2770` | Setgid shared log directory; role-created files remain group-writable. |
| `/etc/blackspire/` | `root:blackspire` | `0750` | Config dir. |
| `/etc/blackspire/command.env` | `root:blackspire` | `0640` | Shared non-authentication production settings. Loaded by API and worker; must contain no password verifier, bearer token, or session secret. |
| `/etc/blackspire/command-api.env` | `root:blackspire-api` | `0640` | API-only password verifier, optional machine bearer token, and session secret. The distinct worker UID and group cannot read it. |
| `/etc/systemd/system/blackspire-command.service`, `blackspire-command-worker.service`, `blackspire-command.target` | `root:root` | `0644` | Reviewed API, worker, and coordination units; only root manages. |

### Directories that MUST remain root-owned (runtime must NOT own or write)

- `/opt/blackspire-command/releases/*` and `current` (immutability boundary).
- `/etc/systemd/system/blackspire-command.service` and all systemd paths.
- Other services' journal files and `/var/lib/docker/containers/*`; Blackspire rotation must never
  target broad host or container globs.
- `/etc/blackspire/command.env` is `root:blackspire 0640`; the API-only file is
  `root:blackspire-api 0640`. Both are root-owned and runtime read-only.

### Config that must not be broadly readable

- `/etc/blackspire/command.env` → `0640 root:blackspire` (no world bits). Contains shared settings
  only. `/etc/blackspire/command-api.env` is `0640 root:blackspire-api` and contains the admin
  token and session secret. Method/name only ever appears in memory docs — never a value.

## Logging

The app, worker, and role-specific supervisors log line-delimited JSON to stdout/stderr. The API
writes `/var/log/blackspire-command/command.log`; the worker writes `worker.log`. Systemd creates
the isolated setgid directory with `UMask=0007`. The reviewed logrotate policy names both files exactly,
uses `copytruncate`, and never rotates Docker-wide or unrelated host logs.

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
- The API and worker runtime identities need **no** capabilities: the production port is
  unprivileged, so no
  `CAP_NET_BIND_SERVICE`; the unit template sets an empty capability set.

## Validation against repository tooling

| Tool | Requirement | This map satisfies it because |
|---|---|---|
| `verifyVpsRuntime` | uid ≠ 0; role-specific `BLACKSPIRE_RUNTIME_USER` == effective user; DB parent exists; each of `[dbParent, shared/database, shared/evidence, shared/backups]` writable and owned by the role uid or one of its groups; PORT 1–65535; bounded timeouts | API and worker use distinct non-root identities in shared group `blackspire`; persistent directories are setgid/group-writable `2770`; `releases/*` is excluded from the writable set so its root ownership does not fail the gate. |
| `verify-environment.sh vps-production [api|worker]` | non-root; `BLACKSPIRE_RUNTIME_USER` ≠ root; DB parent exists; PORT syntax valid; API alone requires the port to be free; timeouts valid; no implicit migrations | Both roles validate one shared profile, while a worker restart cannot be blocked by the healthy API listener that owns the port. |
| `scripts/production-supervisor.js` | runs `verifyVpsRuntime`, validates deployment identity, then spawns exactly the selected API or worker role | The independent services run as `blackspire-api` and `blackspire-worker`; each passes its role-bound gate before spawn. |
| `scripts/backup.js` | default dest = `shared/backups` (never inside a release, outside the DB dir); target not a symlink; 0700/0600 | `shared/database` → `defaultBackupDir` returns `shared/backups`; `shared/backups` is outside `shared/database` and not under `releases/`. |
| `scripts/restore.js` | disposable owner-private target, never the live DB; backup preserved | Rehearsal uses a disposable path under a temp dir; it does not promote a restored file. Any separately authorized production cutover must normalize the final live DB to the reviewed `blackspire-api:blackspire` group-writable contract before either service restarts. |
| `release-create.sh` / `release-rollback.sh` | archive to `releases/<sha>`; switch only the symlink | Run as root/deploy with write to `releases` + `current` only. |

Credential-free fixture verification of the `verifyVpsRuntime` expectations is in
`verify-ownership.sh` (run with a Node 22 runtime). It builds a throwaway directory tree
mirroring this map and asserts the gate passes, with no secrets and no live-path mutation.
