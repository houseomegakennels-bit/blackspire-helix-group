# ZOLA n8n access restored — activation evidence

Verified 2026-09-06 UTC. This record supersedes older assertions that n8n management and Supabase recovery-point/control evidence are unavailable. It does not authorize an unsafe credential swap, production restore or gate bypass.

## Management and protected rollback snapshot

- Instance: `cpearson0312.app.n8n.cloud`; Personal workspace.
- API auth: PASS, HTTP 200; key file nonempty, 0600, root:root. Key remains process-memory-only during authenticated requests.
- Workflow: `VvMHSIbycYCx4CZN`, `blackspire-buyer-engine`; active and published.
- Version/activeVersionId: `cdd141ba-8d20-4981-b598-6af8e35aff86`; versionCounter 221.
- Created: `2026-05-19T17:09:50.823Z`; updated: `2026-06-07T21:30:11.160Z`.
- Snapshot: `/var/lib/blackspire-operator/backups/n8n-buyer-20260906T223119Z.json`, 0600 root:root, parent 0700.
- SHA256: `35658f2716a5fedab6d502f715bc06a87b13e351a2966cb380c67b6e7b39c206`.
- Fourteen nodes, eleven connection sources; unique names, all graph targets valid, top-level/active-version nodes and connections equal. Protected JSON parsing and offline restoration payload roundtrip independently PASS.
- Visible execution history: zero records, no next cursor. This is not proof that the workflow never ran or that global execution retention is disabled. Workflow settings specify only executionOrder v1; success/error/manual/progress save settings are unspecified.
- Webhook: POST `buyer-engine`, authentication none. No webhook invocation or publish/update/deactivate request occurred.

The backup contains embedded credentials and must never enter Git or public evidence. Live API restoration has not been rehearsed. A successful local payload roundtrip does not prove publication semantics or preservation of server-generated revision IDs. Current [official n8n update API specification](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/updateWorkflow.generated.yml) warns that updating a published workflow can automatically republish it and that a permission failure can still leave a saved draft. Verify deployed API behavior in isolation and use explicit publication control; never test write scope with a production PUT.

Read-only credential schema requests for httpHeaderAuth and httpCustomAuth both return HTTP 200 and expose domain restriction fields. Credential-creation permission remains untested; no unsupported claim that the API cannot create secure credentials is made.

## Actual writer map


Every operation below uses the same legacy anon JWT as both apikey and Bearer token, embedded in JavaScript. It is not a privileged service-role key. No node has an n8n secure credential attachment.

| Node | Table | Method | Reviewed migration impact | Future identity |
| --- | --- | --- | --- | --- |
| Start Job | SearchJob | PATCH processing/timestamp by caller job ID | Denied | Scoped gateway job lifecycle operation |
| Start Job | CountyDataSource | GET active sources by state/county | Unchanged by Buyer migration | Gateway allowlisted source lookup |
| Pull Sales Data | SearchJob | PATCH failed when all sources fail | Denied | Scoped gateway job lifecycle operation |
| Normalize and Save Sales | RawSale | POST normalized rows in chunks of 50 | Original migration omitted; amended migration denies | Scoped gateway insert tied to authorized job |
| Normalize and Save Sales | CleanSale | POST date/property-filtered rows in chunks of 50 | Original migration omitted; amended migration denies | Scoped gateway insert tied to authorized job |
| Process Score Save Buyers | BuyerProfile | POST upsert on buyer_name,mailing_address, return representation | Denied | Gateway internal shared-profile upsert; return only required result metadata |
| Process Score Save Buyers | BuyerReport | POST reports with profile FK in chunks of 50 | Denied | Gateway insert tied to authorized job; resolves profile IDs internally |
| Complete Job | SearchJob | PATCH completed/counts/timestamp | Denied | Scoped gateway job lifecycle operation |
| Fail Validation | SearchJob | PATCH failed if supplied ID exists | Denied | No mutation without verified dispatch authority |
| Fail No DataSource | SearchJob | PATCH failed | Denied | Scoped gateway job lifecycle operation |

No other Supabase request sites found in node JavaScript. Pull Sales Data also has external county/source GET request sites. JWT repeats in seven nodes: Start Job, Pull Sales Data, Normalize and Save Sales, Process Score Save Buyers, Complete Job, Fail Validation, Fail No DataSource. Pattern review finds no additional literal service-role JWT or n8n credential assignment. This is a source-pattern audit, not proof that arbitrary obfuscated secrets cannot exist. Remediation: remove all seven database key literals and use secure gateway credential only. External source URLs are routing dependencies; constrain via authoritative registry and egress policy.

## Critical source findings

1. Receive Search accepts POST /webhook/buyer-engine without authentication. A secure database credential swap would elevate this public input to a confused deputy.
2. Validate Payload returns {valid,missing,...body}, so caller valid/missing values overwrite validation. It checks only truthy required fields, not UUID/date/bounds/ownership.
3. Every SearchJob PATCH concatenates unencoded caller search_job_id into PostgREST query. No owner/workspace check exists in workflow. user_id from caller is neither proof nor checked authority. Caller raw_sales is accepted, permitting untrusted data injection and unbounded payload processing.
4. Start Job overwrites sources/source_url/source_type from DB, so arbitrary source_url alone is NOT proven a direct caller SSRF override. CountyDataSource nevertheless supplies external request targets; require trusted registry and no caller URL authority in replacement.
5. All nine DB write request sites suppress HTTP status errors. Successful-looking counts/completion can diverge from persisted writes, or profile response parsing can fail after partial writes. No transaction, idempotency ledger or attempt/generation guard exists. Retrying can duplicate sales/reports or overwrite global profile state.
6. BuyerProfile is globally upserted on buyer_name,mailing_address and its entire representation returned to n8n. Preserve deliberate shared profile semantics server-side, with minimal return and no cross-owner payload read through the writer API.
7. Workflow settings only specify executionOrder v1. Save-on-success/error/manual/progress policies are absent and cannot be inferred from zero visible executions. Set explicit minimal safe retention without deleting existing history, ensuring execution data never captures dispatch credentials/capabilities.


## Offline behavior proof and replacement boundary

`/tmp/zola-n8n-offline-audit.mjs` evaluates only selected credential-redacted node code with synthetic inputs and a mock HTTP helper; no network is exposed. It reproduces input overriding validation, a denied write yielding success, and caller input adding a REST filter. Zero production HTTP calls and mutations. These are current defects, not replacement validation.

Use separate secure credentials for frontend-to-n8n intake and n8n-to-gateway HTTP requests. Keep database credentials in the server writer boundary. Fixed operations must validate a permit issued through existing authenticated owner-scoped SearchJob dispatch, bind the authoritative job owner and configured workspace, reject table/filter/URL overrides, enforce size/count/time limits, atomically fence stale generations and record idempotent batch receipts. Raw/Clean/Report writes must be bound to the verified job. Global BuyerProfile upsert behavior stays explicit and server-internal; no generic cross-owner catalog read is granted to n8n. Fail on database errors and derive completion counts from committed data.

Existing owner-scoped web authorization can issue workload permits without adding command permission history. Buyer read grants are not write authority; no new permission should be invented merely to make this integration work. Proposed dedicated database role must have no BYPASSRLS, DDL or broad table authority and only fixed reviewed routine permissions. The design is conditionally reviewed, not implemented or activation-approved. Concrete draft: `/tmp/zola-restored-writer-design.md`.

The exact rollback source `2c0b600` sends neither the proposed ingress credential nor job permit. Pausing new Buyer dispatch during recovery is secure but changes availability and requires an explicit recovery-contract decision. Restoring the old anon workflow after hardening does not work and must never lead to restoring unsafe browser grants. No real workflow execution is permitted as a test.

## Supabase operational recovery

QUOTA: CLEARED. RECOVERY POINT EXISTS: YES. OWNER RESTORE CONTROL EXISTS: YES. Owner verified canonical project `kchtrvfcixnimvxxctkj` physical scheduled backup **06 Sep 2026 14:03:39 UTC**, additional prior daily backups and authenticated Restore controls. SUPABASE RECOVERY OPERATIONALLY VERIFIED: YES for point existence, owner restoration capability and this procedure. No actual restore, measured RTO or complete Storage recovery is claimed. Database backups exclude Storage object bytes; preserve objects separately. See [Supabase backup coverage and restoration guidance](https://supabase.com/docs/guides/platform/backups).

### Recovery procedure


1. Pin canonical project kchtrvfcixnimvxxctkj, incident scope, desired point and release identities. Preserve current state and evidence before recovery, including current row counts/digests, migration history, authority database backup, credential configuration metadata and protected n8n definition/version/digest. Keep secrets out of logs.
2. Fence all writers before recovery. Stop ingress/new Buyer work, drain or explicitly preserve in-flight execution state, and verify n8n active executions through management. Stop canonical worker then API under the documented operator procedure; preserve queues and outcome_unknown without replay. Include other actual Supabase writers; stopping ZOLA alone does not prove database quiescence.
3. For an authorized incident only, the owner opens Database > Backups for the canonical project, selects the verified pre-incident physical point and reviews the loss interval. Restore confirmation replaces the current database and causes downtime. Production restore is prohibited in this task. Downtime depends on database size; measured RTO is unknown. Inventory non-Realtime subscriptions/replication slots and follow platform instructions for their restoration.
4. Database recovery covers persisted PostgreSQL contents, including relevant data, schema, RLS/policies, grants, functions, migrations and database-backed Auth/Storage metadata. Verify actual recovered coverage rather than assuming every external service setting is included. Storage object bytes are separate: old metadata cannot restore subsequently deleted objects. Preserve/export needed object bytes and inventory separately, or document missing objects and keep affected operations closed. Never delete Storage objects as a read acceptance probe.
5. Recheck custom-role credential usability after restore and recover/reset credentials through protected mechanisms. Do not put database credentials in workflow JavaScript. The official changelog reports current platform credentials being reapplied after physical restores; this is not proof that every custom writer credential is restored correctly.
6. Before reopening database access, check expected schema/migration versions; RLS and grants; required rows and count/digest evidence; Auth settings and real operator identity; storage bucket/object consistency; own-job reads; cross-owner denial; and the authorized server writer using a safe isolated or rollback-bounded verification path. If the point predates hardening, reapply only reviewed security changes under the migration gate before enabling public access. Do not restore broad anon grants as application rollback.
7. Recover n8n from the root-only management snapshot only through a proven management definition/credential restoration method. Verify snapshot SHA256, parse and structural completeness, target workflow ID, version and credential references. Restore compatible secure credential bindings separately; do not blindly restore an obsolete embedded-anon writer after hardening. Keep execution disabled until the safe writer and source job ownership contract verify. Do not replay unknown/in-flight work or invoke the Buyer workflow as a recovery test.
8. Recover the authority SQLite database from a verified protected consistent snapshot while all actual DB writers are stopped. Verify checksum, SQLite integrity, exact authority history/grant chain and all twelve permission names against the exact recovery artifact. Preserve current queues, sessions and no-replay states. Fence stale generations and revoke copied sessions only in the isolated rehearsal. A rollback of application artifacts normally retains the current compatible authority DB; restoring old authority data requires separate incident reasoning because it can undo grants or resurrect queued work.
9. Application recovery uses only 2c0b600c268faa0571f08322e16d7f81f37789be after functional verification. Verify artifact digest and runtime/frontend pairing; never start retained 608b10 or b71c9c. Start API and verify health, start worker and verify current-generation readiness, verify fencing and transports, then run the six bounded reads with ownership and mutation observers. Reopen ingress only after the actual gates pass. Keep frontend and VPS at the same reviewed release SHA.


## Migration correction and verification limits

Read-only live history confirms reviewed versions `20260904201014` and `20260904223151` are absent. Parent independently verified RawSale/CleanSale unconditional anonymous INSERT policies. Original Buyer migration digest `11664e3794ac39084e789ed445b8a2de244adb5e1bbd3ced019886e823d9da70` omitted those tables. The unapplied file now drops their anonymous insert policies and revokes anon/authenticated privileges, preserving service-role grants and rows. Amended digest: `61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e`. Nexus digest remains `1be43afc6d6964752301f0c80806423dc6b82d054b09748813cf40dca7944e51`.

Pinned PGlite 0.5.8, integrity-verified download, uses 25.4 MB and ran in-memory under Node 22.23.1 with an empty environment and no production credentials/connections. Original eight grouped assertions reproduce the gap. Amended eight groups pass and were independently rerun: failed-transaction rollback, row preservation, reviewed policies, both owner directions, actual browser CRUD denial including Raw/Clean, service-role insert/update/upsert success with rollback, and safe reapplication. Independent source review found no direct repository browser caller for RawSale/CleanSale. Reports: `/tmp/zola-restored-pglite-058/results.json` and `results-amended.json`; runnable fixtures beside them.

This is PostgreSQL 18.3 synthetic integer-ID schema with an auth.uid shim; canonical is PostgreSQL 17.6. It does not prove canonical schema/snapshot compatibility, the future least-privileged writer, n8n continuity or Nexus status-only end-to-end behavior. Full migration gate remains NOT GREEN and production remains UNAPPLIED.

## Runtime, acceptance, disk and PR

Only rollback `2c0b600c268faa0571f08322e16d7f81f37789be` is permitted. Artifact/profile/snapshot/canonical fingerprints match. Inherited boot/provider/authority/grants/health/readiness/generation proof remains valid; all six real reads are NOT RUN, so functional rollback is NO. Exact candidate pairing is unchanged. Canonical API and worker remain inactive/disabled/PID0; retained608 must not start.

Protected authenticated owner and unauthorized witnesses and an authoritative receiver/database/Storage/provider observer are absent. Read-only discovery finds log_statement=ddl, log_min_duration_statement=-1 and pgaudit.log=none; no pgaudit extension among installed checked audit extensions. Counters cannot establish per-task mutation-attempt or zero-paid-provider proof. Two existing Auth users and three SearchJob owner IDs exist, but counts do not supply authenticated sessions. Do not manufacture identities, observations or empty-result acceptance.

Root is 97–98% used, about 2.2 GiB free. The only recommended scoped cleanup is 3.1 GiB regenerable npm content cache `/root/.npm/_cacache`, after confirming no active npm operations. Preserve npm _npx/runtime tools and all repositories/worktrees/authority data/backups/credentials/queues/sessions/rollback artifacts. User approval is pending because the authorized disk task is read-only. No deletion occurred.

PR125 was independently verified OPEN/MERGEABLE at original expected `f934856e2491189cb52a43a83a18a31904cf3b79`, main `53adf74e05c607c0d296923bae05d7ac023ecb57`, with all five checks SUCCESS and CI34045307270 successful. This predates the local SQL amendment; it is not new-head CI evidence. No merge or cutover until every gate passes.

## 2026-09-06 23:17 UTC — protocol implementation increment

Fresh read-only API verification preserves workflow `VvMHSIbycYCx4CZN`, version and protected backup above; no production writer mutation or execution. Sanitized metadata is `/tmp/zola-writer-current-metadata.json`. The alternative workflow ID in the continuation request does not match the actual named workflow.

`packages/buyer-writer/protocol.js` is an independently reviewed, unmounted boundary with seven isolated regression groups. It validates separate dedicated workload/permit inputs without loading credentials, fixed operation envelopes, 100-row/256-KiB/500-chunk per-request limits, exact sale fields and canonical digest binding. It rejects caller-selected owners, counties, row IDs, tables, SQL and profile scores. `buyers.commit` and completion accept no caller facts; the future transactional routines must derive them from committed job sales and preserve reviewed scoring semantics. The protocol does not itself enforce cumulative limits, provenance, HTTP-header duplication, database authority, expiry, cancellation, receipts or generation. Those are mandatory unfinished integration work, not implied by passing protocol tests. No five-table writer test or new workflow backup is claimed.

Fresh canonical column metadata was inspected read-only. The PostgreSQL date incompatibility for year zero was fixed. Official PostgreSQL 17 function documentation confirms that SECURITY DEFINER executes with its owner privileges and that secure search_path/EXECUTE grants require explicit care: https://www.postgresql.org/docs/17/sql-createfunction.html. No new SQL role or routine has been provisioned. Original Buyer/Nexus reviewed hashes remain unchanged and migrations UNAPPLIED.

The only rollback's task dispatch already supports the six-read collector. Its legacy Buyer ingestion lacks authenticated dispatch and still needs a separate continuity solution. Do not patch production task handling just to test rollback. Primary Command login has existing protected access. Cross-owner witnesses and authoritative observations remain incomplete; available SQL and runtime-log tools must be assessed before declaring owner-only blockage. Current supervisor has pre-cleanup failure windows and incomplete descendant containment and must not be executed unchanged.

Authorized exact npm content-cache deletion recovered 3.03 GiB, free 2.13->5.16 GiB. Evidence `/tmp/zola-writer-disk-cleanup.json`; no protected state was deleted. PR125 existing 9d2512e head has five successful checks and remains open. The writer is NOT IMPLEMENTED end-to-end; writer isolated acceptance NOT RUN; functional rollback NO; all six reads NOT RUN; canonical services and migrations held. Autonomous work remains.
