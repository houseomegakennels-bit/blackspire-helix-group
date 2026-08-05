# Disposable restore and cutover rehearsal

Status: **tested with disposable fixtures**. Production restore, cutover, routing, and Gate 4 remain
**intentionally disabled** and require separate operator authorization.

The rehearsal creates a deterministic SQLite source below an explicit
`/tmp/blackspire-rehearsal-*` directory. It invokes the repository migration, backup, and restore
commands, restores to a distinct disposable target, validates checksum, age, schema fingerprint,
integrity, foreign keys, row counts, and an application-level read, then deletes the fixture by
default. It never reads the configured production database.

From a clean reviewed checkout, substitute two distinct reviewed 40-character fixture SHAs:

```bash
npm run recovery:rehearse -- \
  --root /tmp/blackspire-rehearsal-OPERATOR-UNIQUE \
  --environment disposable-staging \
  --operator-ack REHEARSE-DISPOSABLE-CUTOVER \
  --commit <candidate-40-character-sha> \
  --rollback <rollback-40-character-sha>
```

This command is **verified with disposable fixtures**. It emits a backup manifest, restore
verification report, cutover rehearsal report, rollback readiness report, audit records, unresolved
risks, and production decisions still required. `GO_FOR_DISPOSABLE_REHEARSAL` never means production
GO. Production has no GO classification in this tool.

Bounded outcomes are:

- `GO_FOR_DISPOSABLE_REHEARSAL`
- `NO_GO_BACKUP_INVALID`
- `NO_GO_RESTORE_INVALID`
- `NO_GO_SCHEMA_MISMATCH`
- `NO_GO_ENVIRONMENT_MISMATCH`
- `NO_GO_QUEUE_NOT_DRAINED`
- `NO_GO_ROLLBACK_TARGET_INVALID`
- `OPERATOR_AUTHORIZATION_REQUIRED`

Queue drain and maintenance mode are simulations against seeded disposable state. They do not stop
a service or drain a real queue. Rollback verification uses a disposable release marker, not a live
release. RPO, RTO, maintenance window, real credentials, target identity, and Gate 4 remain
operator-owned decisions.
