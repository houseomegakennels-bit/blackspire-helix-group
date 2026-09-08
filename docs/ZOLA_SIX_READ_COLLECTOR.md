# Six-read production collection

The collector submits exactly six fixed `read_only` objectives through the canonical API and validates the durable SQLite task, single dispatch receipt, authority binding, actual frontend observation, bounded output, kernel listener owner, process start times and systemd generations. The production entrypoint requires the clean source checkout SHA to equal the expected runtime SHA, and binds the actual process WORKER_ID separately from systemd InvocationID. The same task is read over authenticated HTTP, then requested using an existing different authenticated principal's session and required to return an exact non-disclosing 404. This is Command task access denial, not Supabase row-owner policy acceptance.

Run from the reviewed release checkout with pinned Node:

```
bash scripts/with-node.sh scripts/zola-six-read-collect.js --dry-run /var/lib/blackspire-operator/preparation/six-read-config.json
bash scripts/with-node.sh scripts/zola-six-read-collect.js --production /var/lib/blackspire-operator/preparation/six-read-config.json
```


The same entrypoint also runs a protected, noncanonical integration acceptance:

```
sudo bash scripts/with-node.sh scripts/zola-six-read-collect.js --candidate
```

Candidate mode accepts no config or credential path. Its supervised child receives an explicit four-variable environment, creates a fresh private network namespace, verifies only loopback exists and no default route exists, then starts the actual API on an ephemeral loopback port. It provisions generated credentials and two principals only in its fresh disposable SQLite database. All six reads traverse the actual HTTP admission and task-disclosure endpoints, exact-key SQLite reconciliation, real claim/dispatcher/receipts and actual frontend route implementations with synthetic division data. The production collector's HTTP boundary is shared, so authentication, response bounds and exact foreign-session 404 verification use the same code. Reopening the durable journal and rerunning adds zero tasks and zero dispatches. Anonymous and wrong-token HTTP admissions are rejected before task creation.

The child uses a root-owned ephemeral directory under `/root`, so the existing protected journal checks remain intact; the supervisor removes only its known database and journal files after the child exits. Child runtime and output limits remain enforced. It does not start systemd services or contact a deployed frontend. Its generation is the real local process/network namespace, **not a production supervisor generation**. Result SHA fields describe synthetic route source/current checkout, not an independently observed live deployment; a digest records the integration's source files. Candidate PASS exits 0 while `livePass` remains false, and cannot satisfy production gates. This proves actual API/collector integration and network-contained synthetic dispatch, not production row-owner policies or production database mutation deltas.

Configuration and credentials must be explicitly supplied, root-owned 0600 JSON under root-owned ancestors without group/other writes or named ACLs. No credentials are discovered or loaded in dry-run. Example schema (replace each value with independently verified deployment metadata; this is not an executable production config):

```json
{
  "version": 1,
  "releaseSha": "0000000000000000000000000000000000000000",
  "frontendOrigin": "https://verified-deployment.example",
  "workspace": "blackspire-command",
  "principal": "blackspire-operator",
  "deniedPrincipal": "existing-other-principal",
  "dealId": "DE-0001",
  "apiPid": 100,
  "workerPid": 101,
  "port": 8789,
  "databasePath": "/opt/blackspire-command/shared/database/command.sqlite",
  "credentialPath": "/var/lib/blackspire-operator/preparation/six-read-credentials.json",
  "journalDirectory": "/var/lib/blackspire-operator/preparation/six-read-journals",
  "runId": "release-acceptance-before-migration"
}
```

The credential object has exactly `bearer` (canonical API administrator credential) and `deniedCookie` (existing valid session Cookie header bound to `deniedPrincipal`). The collector does not create principals, sessions, grants or division rows. If no real second principal/session is available it refuses before admitting any tasks. Production API currently only authorizes its configured operator; a valid different principal session is authenticated by `/api/auth/session` and refused at the protected task boundary. An anonymous or invalid session cannot satisfy this witness.

Create the journal directory as root mode 0700. The journal is hash chained and every intent is fsynced before its POST. SQLite is opened read-only with exact idempotency lookup, including actor/workspace/channel/authority/intent/request binding. A lost response with a found exact task continues collection; absence remains UNKNOWN and is never retried, including a crash before transmission. Preserve the run ID and configuration on rerun. A changed generation refuses reuse. HTTP requests have a four-second timeout and 128 KiB ceiling; each task has at most 60 half-second polling intervals. Concurrent runs sharing a run ID are refused.

A crash leaves `<runId>.lock`. Before removing only that lock, independently verify its recorded PID and `/proc/PID/stat` start time no longer identify a running collector; preserve the `.jsonl` evidence. Torn or corrupted journals require forensic reconciliation and are never truncated automatically. Successful reruns do not create new tasks or provider dispatches. A new run ID intentionally requests six new reads and must only be used for a separately authorized acceptance phase after all uncertain prior admissions are reconciled.

Stdout contains sanitized machine-readable JSON. Stderr contains the human summary. Raw results, contacts, SQL rows, HTTP bodies, cookies and bearer credentials are not logged. Result hashes and bounded counts are recorded; the journal retains sanitized generation/task IDs. The API intentionally writes task, permission, audit and receipt records; this is not literal zero SQLite mutations.

Exit codes: 0 = dry-run plan validated or isolated candidate integration passed; 1 = failed closed; 2 = six live reads collected but complete release acceptance unverified. Production cannot currently return a full PASS. The supplied read-client observation excludes mutation methods and confines its own transport to bounded PostgREST GET/HEAD, but is not process-wide egress evidence or an authoritative division before/after row delta. Nexus reports zero paid-provider calls for this specific dispatch based on the exact-SHA reviewed route and its supplied-client-only contact lookup; this does not claim zero unrelated process-wide activity. Nexus absent status is reported honestly and does not prove a positive stored-contact witness. The executable intentionally holds release on missing process-wide paid-provider evidence, division mutation deltas, and Supabase row-owner denial. Do not substitute caller-provided boolean proofs for these gaps.


## Database observations (configuration version 2)

Use `"version": 2` and add exactly `"observerDatabaseConfigPath"` to the configuration above. That protected JSON contains exactly `host`, `password` and `ca`; the fixed host is the reviewed direct Supabase database, the login is `postgres`, and the CA bytes must match reviewed SHA256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. No ambient PostgreSQL credentials are used. The connection enforces TLS hostname/chain validation and defaults to read-only transactions. Dry-run and SQL-preparation modes never open this credential file.

The collector records a full-row snapshot before its first admission and retains it in the durable run journal. Its fifteen-table scope covers all supplied-client parent/embedded relations plus Buyer write tables. PostgreSQL returns only table names, counts and SHA256 digests of complete row multisets and tuple versions; no row or contact values leave the database. Snapshot transactions use repeatable-read isolation, a 15-second statement timeout, one-second lock timeout and a 250,000-row-per-table bound. Overflow fails closed. A bypass-RLS primary observation is required so filtered or replica data cannot masquerade as complete coverage. Native observations also check database timestamps against the actual query interval.

A separate read-only transaction uses existing `auth.users` records and an existing SearchJob to exercise the actual `authenticated` PostgreSQL role: the real owner must see exactly its job and a distinct real user must see zero. Only a witness digest and counts are returned. This checks the SearchJob database policy; it does not claim a browser session, other application owner boundaries or positive data belonging to both users. Missing real witnesses or a permissive foreign-owner policy stops the collector before admission.

After collection, full-row and tuple-version digests must remain unchanged and the owner witness must still match. Reopening a run reuses its original before snapshot and reconciles the same six tasks; it never silently replaces the baseline after admission. Same-value updates are detected by tuple versions. Successful comparison proves zero net persisted row/tuple-version change in this interval, **not a complete audit of transient/attempted writes or provider egress**. Other application owner checks and complete mutation-attempt/egress evidence still hold production acceptance at exit 2.

Connected Supabase access can obtain the same fixed read-only observations without a native database password:

```
bash scripts/with-node.sh scripts/zola-six-read-collect.js --observer-sql-before /var/lib/blackspire-operator/preparation/six-read-config.json
bash scripts/with-node.sh scripts/zola-six-read-collect.js --observer-sql-after /var/lib/blackspire-operator/preparation/six-read-config.json
```

These modes emit separately executable snapshot/owner queries for the fixed project. They prepare metadata only; imported external JSON is not accepted as proof that observations bracketed a collector run. Actual connected development observations covered all fifteen tables and demonstrated SearchJob own/foreign policy behavior without data mutation. Those standalone observations are not six-read production acceptance. The native integrated observer still needs its explicit credential capability, and a real second Command session remains a separate prerequisite.

`tests/zola-six-read-database-observer.test.js` covers strict metadata, coverage, row/version drift and sanitized rollback. `scripts/test-zola-six-read-database-postgres.mjs`, using the existing pinned `BUYER_WRITER_TEST_IMAGE`, exercises the actual SQL in a disposable PostgreSQL 17.6 container with no network or host mounts. It verifies own/foreign visibility, unchanged snapshots, same-value update detection, permissive-policy rejection, missing witnesses and actual read-only write rejection.


## Connected transport and delegated session (versions 3 and 4)

Version 3 uses the fixed HTTPS Supabase Management API `POST /v1/projects/kchtrvfcixnimvxxctkj/database/query` with `read_only: true`, verified TLS and no redirects. Its explicit protected `observerDatabaseConfigPath` contains exactly `projectId` and `accessToken`. It never extracts the connected MCP application's token or accepts imported query results. The [official query contract](https://supabase.com/docs/reference/api/v1-run-a-query) requires a supported Management API token. The separate `/read-only` endpoint uses a different role and cannot satisfy the current observer's postgres/SET ROLE witness contract. Live Management API result batching and role compatibility remain unverified until a gated observation actually succeeds; HTTP errors or incompatible result shapes stop the run.

Every connected query records a fsynced intent before transmission. PostgreSQL echoes a digest binding the release, complete config, runtime generations, run, phase, query kind, unpredictable nonce and preceding journal prefix. Query/result digests and bounded database clock observations are persisted before the baseline can authorize admissions. A request without its durable validated result remains UNKNOWN and is never automatically retried. Once an after query has begun, a collector rerun fails closed before creating new collected events or timestamps: retained historical evidence cannot be relabeled as fresh collection.

Version 4 adds `denialReceiptPath` and consumes the protected receipt from the root-only delegated session tool. Its API `credentialPath` contains **only** `bearer`; no manual copying of session cookies is needed. The receipt is verified against release/run/workspace/principal, canonical DB inode, original session, exact issuance audit, expiry and absence of active grants across all workspaces. The collector then checks the actual authenticated HTTP identity, including before and after task disclosure. A forged, expired, revoked or mismatched receipt fails before admissions.

Example version 4 metadata (illustrative values only):

```json
{
  "version": 4,
  "releaseSha": "0000000000000000000000000000000000000000",
  "frontendOrigin": "https://verified-deployment.example",
  "workspace": "blackspire-command",
  "principal": "blackspire-operator",
  "deniedPrincipal": "existing-other-principal",
  "dealId": "DE-0001",
  "apiPid": 100,
  "workerPid": 101,
  "port": 8789,
  "databasePath": "/opt/blackspire-command/shared/database/command.sqlite",
  "credentialPath": "/var/lib/blackspire-operator/preparation/six-read-bearer.json",
  "denialReceiptPath": "/var/lib/blackspire-operator/preparation/denial-receipt.json",
  "observerDatabaseConfigPath": "/var/lib/blackspire-operator/preparation/observer-management.json",
  "journalDirectory": "/var/lib/blackspire-operator/preparation/six-read-journals",
  "runId": "release-acceptance-before-migration"
}
```

`scripts/zola-denial-session.js --issue <protected-input.json>` is an explicit root-authenticated delegation to an **existing** distinct active canonical admin principal. It requires no active grants in any workspace, exact clean release source, actual canonical API/worker activation identity and the canonical API's configured operator/database. Issue input has exactly `configurationFile`, `deniedPrincipal`, `outputPath`, `releaseSha`, `runId`, and `workspace`; paths refer to protected existing configuration and a new exclusive receipt file. It creates a session through the shared session subsystem, with an audited maximum 15-minute lifetime. This is operator-issued authentication, not a second person's password login. It creates no principal or grant. The receipt is fsynced before transaction commit; on uncertainty, preserve it and reconcile instead of repeating issuance.

`scripts/zola-denial-session.js --revoke <protected-input.json>` accepts exactly `receiptFile`. Revocation uses root authentication, the original protected receipt, canonical DB inode and exact original session/audit binding. It remains available after service shutdown or release movement, revoking the original and bounded rotated descendants only. Restore/inode mismatch fails for explicit reconciliation. The tool never prints session IDs, cookies, CSRF values or bearer credentials. Tests exercise issuance, rollback on failed publication, cross-workspace grant rejection, real non-root refusal, bounded rotation/revocation and receipt forgery denial on disposable SQLite.

These additions prepare supported authentication and connected observation paths. They have not issued a production session or made production database observations. Missing live deployment acceptance, other capability owner witnesses and complete mutation-attempt/provider-egress evidence keep `livePass: false`.
