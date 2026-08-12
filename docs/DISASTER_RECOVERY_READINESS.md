# Disaster Recovery Readiness

Status: backup verification implemented in a draft branch. Production recovery objectives,
encryption, off-host storage, scheduling, and alert installation require operator decisions/actions.

## Verified repository capabilities

- WAL-safe `VACUUM INTO` backup with source/snapshot table comparison, integrity check, mode 0600,
  SHA-256 sidecar, and partial-artifact cleanup.
- Disposable-only restore with checksum, complete schema, pre/post-copy integrity validation,
  atomic no-overwrite publication, and live-target refusal.
- Read-only latest-backup verification through `npm run db:verify-backup -- <directory>
  --max-age-hours <hours>`. It selects the canonical latest timestamped snapshot, rejects symlinked
  or missing artifacts, streams checksum verification, checks SQLite integrity and current schema,
  applies an optional age ceiling, and prints only basename and sanitized status metadata. The
  verifier fails closed unless the runtime proves no-follow opens and same-inode `/proc/self/fd`
  descriptor access before opening the snapshot.

The verifier does not create, repair, delete, rotate, upload, decrypt, or restore anything. A green
result proves the selected local snapshot is presently readable and compatible; it does not prove
off-host survivability or a successful end-to-end restore rehearsal.

## Operator decisions still required

- Recovery point objective (RPO): maximum acceptable backup age.
- Recovery time objective (RTO): maximum time to restore service.
- Backup frequency, local retention count/duration, capacity budget, and deletion authority.
- Encryption mechanism and key custody/rotation/revocation.
- Off-host provider, region/failure-domain separation, immutability/versioning, and access policy.
- Alert recipients/escalation and rehearsal frequency.
- Production restore authorization and incident commander.

No default is safe to invent for these values. Until recorded and tested, disaster recovery remains
incomplete even when local backup verification passes.

## Credential-free verification procedure

1. Stop or quiesce writers under the environment's approved procedure.
2. Run the existing backup command against the explicitly named environment backup directory.
3. Run the verifier with the operator-approved RPO translated to `--max-age-hours`.
4. Restore that exact snapshot only to a new disposable target.
5. Run schema/integrity checks and a no-provider application smoke against the disposable target.
6. Record sanitized timestamps, basename, size, verifier result, restore duration, and smoke result.
7. Remove only the explicitly identified disposable restore target after evidence review.

Production backup, restore, upload, retention deletion, and key operations require separate bounded
authorization. This repository change runs none of them.

## Recovery outline

During an incident: stop writers, preserve evidence, identify the intended environment and exact
known-good release, verify the chosen backup, restore to a new target, validate it, then atomically
activate code/config/data only under incident authority. Never overwrite an uncertain live database,
copy SQLite without its WAL-safe procedure, use a staging backup as production state, or treat
`integrity_check` alone as proof of Blackspire schema completeness.

## Remaining gaps

- No encrypted/off-host backup implementation or evidence.
- No retention scheduler or safe pruning implementation.
- No installed backup-age alert or alert-delivery test.
- No recorded production RPO/RTO.
- No recent authorized production recovery rehearsal at the current exact release/schema.
- No cross-region/failure-domain recovery evidence.
