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

API startup, worker startup, and the production supervisor never run migrations. They open only an existing compatible schema and fail closed with an actionable migration-required error when the schema is missing or outdated. Run migrations only as a separate controlled command during an approved writer outage:

```sh
BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js
```

Every other value, including absent, empty, `false`, `0`, and malformed values, is denied. Verify a WAL-safe backup and isolated restore before any future production migration, then run integrity and health checks before resuming writers.

## Release and rollback

Use `release-create.sh` to archive an exact full SHA into `releases/<sha>` and `release-switch.sh` to atomically update `current`. Keep `current` and the prior completed release until health checks pass. `release-rollback.sh <known-good-sha>` changes only the symlink; it does not rewrite Git history. Persistent database, evidence, and backup paths live under `shared/`, never inside a release.

## SQLite backup and restore

Stop all database writers before production backup. Run `node scripts/backup.js <shared-backup-directory>`; it uses SQLite `VACUUM INTO` for a consistent WAL-aware snapshot, applies mode 0600, writes a SHA-256 sidecar, and runs `PRAGMA integrity_check`. Rehearse with `node scripts/restore.js <backup.sqlite> <disposable-target.sqlite>` only. The restore script refuses production mode and the configured live database path. Never copy only `command.sqlite` while WAL files may exist.

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
