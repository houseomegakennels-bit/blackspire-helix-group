# Rollback and recovery runbook

## Application rollback

**REQUIRES OPERATOR AUTHORIZATION.** Validate the known-good immutable release, then use the repository rollback interface:

```bash
bash scripts/release-preflight.sh <known-good-40-character-sha>
npm run release:rollback -- <known-good-40-character-sha>
BLACKSPIRE_HEALTH_URL=http://127.0.0.1:<production-port> npm run health:check
```

The rollback command switches the release symlink; service restart/cutover remains an operator action. Automatic rollback is NOT YET IMPLEMENTED.

## Backup and disposable restore drill

**VERIFIED with disposable fixtures.** Stop every writer to the explicitly named disposable source
database first. Never inherit `BLACKSPIRE_DB_PATH` from another shell or environment:

```bash
BLACKSPIRE_DB_PATH=<absolute-disposable-source.sqlite> npm run db:backup -- <absolute-disposable-backup-directory>
BLACKSPIRE_DB_PATH=<absolute-disposable-source.sqlite> BLACKSPIRE_DISPOSABLE_RESTORE=true npm run db:restore -- <absolute-disposable-backup.sqlite> <absolute-disposable-target.sqlite>
```

Production restore/cutover is NOT YET IMPLEMENTED and must not be improvised. Verify checksums and SQLite integrity using the supported restore drill first. Queue drain is PARTIALLY VERIFIED through worker graceful-shutdown tests; a host-level drain command is NOT YET IMPLEMENTED.

## Complete disposable cutover rehearsal

**TESTED WITH DISPOSABLE FIXTURES; NOT PRODUCTION-AUTHORIZED:**

```bash
npm run recovery:rehearse -- --root /tmp/blackspire-rehearsal-OPERATOR-UNIQUE --environment disposable-staging --operator-ack REHEARSE-DISPOSABLE-CUTOVER --commit <candidate-40-character-sha> --rollback <rollback-40-character-sha>
```

See `docs/RESTORE_CUTOVER_REHEARSAL.md`. The result verifies only temporary SQLite state and a
simulated cutover/rollback plan. It does not stop services, alter routing, or authorize recovery on
production data.

## Recovery objectives

RPO and RTO are NOT YET OPERATOR-APPROVED. Secret rotation REQUIRES CREDENTIAL OWNER ACTION. Preserve immutable releases and backup artifacts during incident handling.
