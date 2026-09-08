# Guarded Buyer/Nexus application executor

This command executes only the exact reviewed application package. It does not
execute provider ACL changes, provision writer roles, publish n8n, or establish
release acceptance. The release commander must first verify every live gate,
including the exclusive provider/ACL administration window, writer continuity,
fresh backups, rollback, and six reads. Production remains unapplied.

Run from the clean checkout at the exact release SHA with Node 22.23.1 as root:

```sh
bash scripts/with-node.sh scripts/execute-buyer-migration.js --dry-run /protected/input.json /protected/dry-run.jsonl
# Only after the release commander's preconditions pass:
bash scripts/with-node.sh scripts/execute-buyer-migration.js --apply /protected/input.json /protected/apply.jsonl
# After any uncertain attempt, use a new evidence filename and reconcile only:
bash scripts/with-node.sh scripts/execute-buyer-migration.js --reconcile /protected/input.json /protected/reconcile.jsonl
```

Input is an explicit root-owned protected JSON file with exactly these keys:

| Key | Source |
| --- | --- |
| `releaseSha` | Exact clean checkout HEAD, 40 lowercase hexadecimal characters |
| `providerManifest` | Reviewed provider manifest object, whose full baseline must still match |
| `manifestBytes` | Exact UTF-8 contents of prepared application `manifest.json`, including final newline |
| `body` | Exact UTF-8 contents of prepared `application-body.sql` |
| `expectedManifestSha256` | Independently verified application manifest SHA256 |
| `migrationVersion` | Explicit 14-digit invocation version selected once for this combined operation |
| `databaseConfigPath` | Explicit protected credential JSON path; never auto-discovered |

The executor regenerates the reviewed package and requires byte equality. It
records this combined invocation in `supabase_migrations.schema_migrations`
using the actual invocation version, exact body in `statements`, exact release
name and idempotency key. It never claims the two historical source-file
versions were individually applied.

Database configuration contains exactly `host`, `password`, and `ca` (the PEM
certificate contents). The only accepted host is
`db.kchtrvfcixnimvxxctkj.supabase.co`; port 5432, database `postgres`, username
`postgres`, certificate verification and bounded connection/query timeouts are
fixed. Never put this configuration in Git. Dry-run does not read it or connect.

Current access verification (2026-09-08): the connected Supabase `postgres`
identity owns the history table and has schema usage, SELECT and INSERT rights.
The local protected operator inventory and known environment files did not
contain a direct postgres password/configuration. Existing scoped writer
passwords are unprovisioned and are not postgres credentials. Native execution
therefore still needs an explicit valid database configuration; do not describe
this CLI as a presently connected production fast path. The connected Supabase
`apply_migration` transport remains a separate accessible possibility, with its
own transaction and invocation-history semantics. Never send this CLI's COMMIT
wrapper through an API-owned migration transaction or reset a production
database password merely to satisfy this prerequisite.

Before connecting for apply, the CLI creates an immutable, fsynced intent at
`/var/lib/blackspire-operator/migration-operations/<releaseSha>-<bodySha256>.json`.
An existing intent refuses every subsequent apply, even with a different
evidence filename. Do not delete an uncertain intent to retry. Evidence files
are exclusive, root-owned, append-only JSON Lines; a partial later line cannot
erase an earlier durable intent. Dry-run leaves no apply intent.

One dedicated PostgreSQL session verifies the nonsuperuser identity and holds
a fixed transaction advisory lock. The reviewed body and exact migration
history insert commit together. Existing exact history returns
`committed-history-verified`; mismatched history fails. Missing history during
reconciliation returns `not-recorded-retry-not-authorized`, and a busy backend
fails closed. A lost COMMIT response returns `OUTCOME_UNKNOWN`; there is no
automatic retry. Keep the exact clean source checkout available for later
reconciliation. All returned statuses explicitly have
`productionAcceptance:false`; fresh post-migration reads remain mandatory.

Verification includes dedicated-session fault tests, actual protected-file
restart tests and an actual PostgreSQL 17.6 rehearsal:

```sh
env -i PATH="$PATH" \
  BUYER_WRITER_TEST_IMAGE=postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94 \
  bash scripts/with-node.sh scripts/test-buyer-migration-executor-postgres.mjs
```

The root rehearsal creates only its owned disposable container with no network,
read-only root filesystem and capped tmpfs/memory. Its actual pg driver child
verifies the owned network namespace, loopback-only interfaces and absent
external routes before connecting to synthetic PostgreSQL. It checks atomic
history, exact replay, busy-backend denial, real commit with lost acknowledgement,
provider drift and history tampering. No production credentials or SQL are used.
