# Disposable restore and cutover rehearsal

Status: **tested with disposable fixtures**. Production restore, cutover, routing, and Gate 4 remain
**intentionally disabled** and require separate operator authorization.

The rehearsal creates a deterministic SQLite source below an explicit
`/tmp/blackspire-rehearsal-*` directory. It invokes the repository migration, backup, and restore
commands, restores to a distinct disposable target, validates checksum, backup age, schema
fingerprint, integrity, row counts, and an application-level read, then deletes the fixture by
default. It never reads the configured production database.

Scope of the verification claims:

- **Backup age** is derived from the real backup artifact's `mtime` and is reported as
  `backupManifest.ageMs`. Backups older than 24h fail closed as `NO_GO_BACKUP_INVALID`. This is
  load-bearing through the shipped CLI, which passes no clock override.
- **Foreign keys**: `PRAGMA foreign_key_check` is executed, but the Blackspire schema declares **no
  FOREIGN KEY constraints** (`scripts/migration-writer.js`), so it returns zero rows on every
  database this tool can produce. The check is currently **inert** and is retained only so it begins
  reporting if constraints are ever added. It is surfaced as
  `restoreVerificationReport.foreignKeyCheckInert: true`. No fault is detected by it, and this tool
  provides **no** referential-integrity evidence.
- **Checksum** and **source/target distinctness** are verified here *and* independently by
  `scripts/restore.js`, so they are defence in depth rather than the sole guard.
- Queue drain, maintenance mode, and `interrupted_cutover` are **simulations** against seeded
  disposable state, not detections against a live service.

Fault injection is a **test-only seam**. The shipped CLI exposes no `--fault` flag, and the module
throws unless `BLACKSPIRE_REHEARSAL_FAULT_INJECTION=1` is set, so faults are unreachable in
operator use.

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

## Measured fault inventory

`tests/disposable-restore-cutover-mutation.test.js` performs **real** mutation testing: it perturbs
the shipped module source, loads the perturbed copy, runs the scenario each guard should catch, and
records the observed classification. The shipped file is never modified (its SHA-256 is re-verified
after every mutant). Measured on Node 22.23.1:

- **11 sole-guard kills** — removing the expression reaches `GO`, so it alone fails the fault
  closed: `backup_age`, `environment`, `authorization`, `schema_fingerprint`, `target_integrity`,
  `row_counts`, `application_read`, `queue_drain`, `maintenance_mode`, `rollback_target`,
  `dirty_tree`.
- **1 redundant kill** — `checksum`: removing it changes the outcome
  (`NO_GO_BACKUP_INVALID` → `NO_GO_RESTORE_INVALID`) but `scripts/restore.js` still fails closed.
- **0 surviving mutants.**
- **Not claimed:** `sourceTargetDistinct` participates in `classification()` and the
  `source_equals_target` fault genuinely aliases the target to the source database, but removing the
  check yields an identical classification because `scripts/restore.js` independently refuses
  `target === BLACKSPIRE_DB_PATH`. It is measurably indistinguishable, so no mutation coverage is
  claimed for it. The alias refusal itself is asserted behaviourally.
- **Not claimed:** foreign-key verification (inert, see above).

Queue drain and maintenance mode are simulations against seeded disposable state. They do not stop
a service or drain a real queue. Rollback verification uses a disposable release marker, not a live
release. RPO, RTO, maintenance window, real credentials, target identity, and Gate 4 remain
operator-owned decisions.
