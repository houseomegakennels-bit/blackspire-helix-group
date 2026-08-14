# VPS Runtime Runbook

## Durable runtime

The existing supervised VPS service and port 8787 are outside the disposable-test lifecycle. Confirm its health with its established operator tooling before and after a test; never point a test launcher at its data path or port.

For a separately approved production start, install the supported Node runtime, create an immutable release with `scripts/release-create.sh <full-sha>`, inject the approved profile through the external configuration mechanism, and point `BLACKSPIRE_RELEASE_DIR` at the completed release. The no-external-provider profile is mandatory:

```sh
npm ci --ignore-scripts
bash scripts/verify-environment.sh vps-production
npm run start:production
```

The profile requires `NODE_ENV=production`, `BLACKSPIRE_RUNTIME_MODE=production`, state owner `vps-production`, persistent non-`/tmp` storage, authentication configuration, `BLACKSPIRE_PROVIDER_MODE=manual`, restricted Hermes, dry-run Telegram, and no provider or Telegram credentials. It rejects test mode and mock Telegram.

### Hermes workspace root

`BLACKSPIRE_WORKSPACE_ROOT` names the git checkout Hermes uses as the cwd for its git and build operations (the seeded workspace's `root_path`). It is read from the server's own environment only — never from a request, a frontend value, or a task payload — and `/api/workspaces` remains read-only.

Set it on a durable host. The systemd unit runs with `WorkingDirectory=/opt/blackspire-command/current` under `ProtectSystem=strict` with only `/opt/blackspire-command/shared` writable, so the process cwd is an immutable release that the `blackspire` account cannot modify. Left unset, the workspace root stays at the historical `.`, which points Hermes at exactly that read-only tree; the operations then fail rather than corrupt anything, but they fail late, mid-task. Point it at a real writable checkout instead — never inside `releases/`, and never at the release root.

When the variable is set it is validated at startup and **fails closed**: it must be absolute (a relative value would resolve against the immutable release), must exist, must be a directory, must not be a symlink, and must be a git checkout (`.git` as a directory or a linked-worktree pointer file; a symlinked `.git` is refused). An unusable value is always a refusal — it never silently degrades back to `.`. Leaving the variable unset is the only supported way to select the default.

This setting does not change binding or ports: the production listener remains loopback-only on its explicit port, and 8787/8788 stay reserved.

API startup, worker startup, and the production supervisor never run migrations. They open only an existing compatible schema and fail closed with an actionable migration-required error when the schema is missing or outdated. Schema-writing code is private to `scripts/migration-writer.js` and is invoked only by `scripts/migrate.js`; runtime modules, wrappers, fixtures, and tests do not import or call it. Run migrations only as a separate controlled command during an approved writer outage:

```sh
BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js
```

The command permits only the exact lowercase value `true`. Every other value, including absent, empty, `false`, `FALSE`, `0`, `1`, `yes`, whitespace-padded `true`, and malformed values, is denied before mutation. Disposable tests prepare schemas by launching this dedicated command with the flag scoped to that child process only. CI scopes the same flag to its one disposable migration command, and Codespace readiness never runs a migration as ordinary startup. Verify a WAL-safe backup and isolated restore before any future production migration, then run integrity and health checks before resuming writers.

## Release and rollback

`BLACKSPIRE_STATE_OWNER` must be exported for both `release-create.sh` and `release-switch.sh`. The
release manifest is sealed with the environment that owner names, and `release-switch.sh` records the
same environment in the release's deployment record and refuses to make the release current unless the
two agree. A release built without an owner is sealed `unassigned` and will be refused at startup on
`vps-staging` and `vps-production`; set `BLACKSPIRE_EXPECTED_ENVIRONMENT` explicitly only to override
that derivation deliberately.

Use `release-create.sh` to archive an exact full SHA into `releases/<sha>` and `release-switch.sh` to atomically update `current`. Keep `current` and the prior completed release until health checks pass. `release-rollback.sh <known-good-sha>` changes only the symlink; it does not rewrite Git history. Persistent database, evidence, and backup paths live under `shared/`, never inside a release.

The privileged release creator accepts only a clean, non-root absolute release root (no `.`/`..` traversal or repeated separators), rejects symlinked ancestors before account/ownership work, then brings both that root and its `releases/` parent to the exact `root:blackspire` / `0755` contract. Every completed `releases/<full-sha>` tree is also `root:blackspire`: directories and archived executable files are mode `0755`; ordinary files, including `COMMIT_SHA` and `.release-complete`, are mode `0644`. Safe review/development metadata (`.agents`, `.claude`, `.devcontainer`, `.github`, `.githooks`, `.vscode`, `AGENTS.md`, and `tests`) is not archived into a release. One shared validator serves create, explicit preflight, switch, and rollback: every symlink must resolve to an existing canonical target inside that release; dangling links, loops, escapes, and symlinked ancestors fail closed. The completion marker is created with no-clobber semantics only after copy, containment/type, ownership, and mode validation succeed; its pre-existence or symlink status fails creation.

This lets the `blackspire` systemd runtime traverse the full release, read application/static files, and execute required entrypoints without granting it any release-content write permission. It cannot create, modify, rename, delete, chmod, chown, or insert links in a completed release. Runtime-readable is not runtime-writable: databases, evidence, backups, and any optional writable logs remain under separately owned `shared/` directories, never in `releases/<sha>`.

Creation fails closed for symlinked root ancestors or destinations, path traversal, incomplete destinations, ownership/mode/marker failures, and block/character/FIFO/socket entries. Failure cleanup removes only its named temporary incomplete artifact; it never mutates an active/completed release or shared state. Rollback keeps using the prior completed immutable release and changes only `current`. These source-only checks do not rebuild staging or authorize Gate 3.

## SQLite backup and restore

Stop all database writers before production backup, so the snapshot is a deliberate, quiesced restore point. Run `node scripts/backup.js <shared-backup-directory>`; it uses SQLite `VACUUM INTO` for a consistent WAL-aware snapshot, applies mode 0600, writes a SHA-256 sidecar, and runs `PRAGMA integrity_check`. The snapshot is WAL-safe even when a writer connection is open and the WAL has not been checkpointed — Gate 3 proves a row committed into an uncheckpointed WAL is present after backup and restore — but that is a safety property, not a licence to skip the writer stop. Rehearse with `node scripts/restore.js <backup.sqlite> <disposable-target.sqlite>` only. Never copy only `command.sqlite` while WAL files may exist.

`PRAGMA integrity_check` alone is **not** sufficient evidence that a file is a usable backup. SQLite treats an empty or zero-byte file as a valid, newly-created database with zero tables, so integrity passes on a snapshot that contains nothing. Both scripts therefore prove content independently of integrity, and both fail closed.

Backup refuses to record a snapshot that could never be restored:

- A source database containing no tables is refused before any artifact is written. A zero-byte or empty `command.sqlite` is never snapshotted.
- After `VACUUM INTO`, the snapshot's table set is re-derived and compared against the source's, rather than trusting that `VACUUM INTO` reported success. A snapshot missing tables the source had is refused.
- The source is deliberately **not** held to the current application schema. A backup taken immediately before a migration legitimately carries an older schema and must still be taken; enforcing the current Blackspire schema is the restore side's responsibility. Do not "fix" a pre-migration backup refusal by migrating first — take the backup, then migrate.
- A refused backup leaves no artifact and no checksum sidecar behind.

Restore proves the backup is a real Blackspire database before it publishes anything:

- A zero-byte backup is rejected before SQLite is allowed to open it.
- The backup is validated read-only against the required Blackspire schema (table and column completeness, via `packages/shared/schema-validation.js`) **before** any byte is written to the destination, and the copy is independently re-validated afterwards rather than trusting that the copy succeeded.
- Publication is atomic: the copy is written to a uniquely named temporary file in the destination directory, fsynced, validated, then linked into place. An existing destination causes a refusal, never a silent overwrite, and is left byte-identical.
- A missing or mismatched checksum sidecar, a symlinked backup or destination, a directory supplied as either, a truncated or corrupted file, and a partial/incomplete schema are all refused.
- Every refusal leaves no restored target and no temporary artifact, and never modifies the source backup.
- Restore additionally refuses production mode (absent an explicit disposable flag) and the configured live database path.

Verify the latest local snapshot read-only with an operator-approved age ceiling:

```sh
npm run db:verify-backup -- /opt/blackspire-command/shared/backups --max-age-hours <approved-RPO-hours>
```

This streams checksum verification and re-proves integrity plus the current required schema without
printing an absolute path or digest. It does not restore, rotate, upload, encrypt, or repair a backup.
See `DISASTER_RECOVERY_READINESS.md`; off-host encryption, retention, RPO, and RTO remain operator-owned.

The single required-schema contract lives in `packages/shared/schema-validation.js` and is shared by application startup (`packages/task-engine/db.js`) and restore validation. Do not duplicate it.

## Monitoring templates

`ops/blackspire-command-healthcheck.sh`, `ops/blackspire-command-logrotate.conf`, and `ops/blackspire-command-monitoring.md` are reviewed operator templates. They are not installed by this repository change. Apply them through the existing host supervisor/logrotate mechanism only after separate approval.

## Temporary iPhone test

Use only the disposable launcher on port 8790:

```sh
npm run start:iphone-test -- quick-tunnel
```

It generates one-time test authentication, creates isolated SQLite state, forces mock Hermes/Telegram, strips inherited provider/GitHub credentials from the child, expires automatically, and uses a pinned Cloudflare client image. The Quick Tunnel URL is temporary and must not be represented as a deployment.

Stop it with:

```sh
npm run stop:iphone-test
```

Interruption and expiry invoke cleanup. Verify the temporary health URL is unavailable and the durable port 8787 remains healthy. Never copy VPS production state into the temporary runtime.
