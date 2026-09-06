# ZOLA remaining gate preparation — 2026-09-06

Quota is CLEARED as of 2026-09-06 16:09:35 UTC: authenticated canonical Auth settings HTTP 200; public frontend Auth status HTTP 200; direct no-key Auth settings HTTP 401 with expected missing-key error. No quota marker remains. Organization plan is independently verified PRO. Production activation remains BLOCKED on actual recovery proof, n8n writer reconciliation and acceptance witnesses. Historical n8n management still returns HTTP 404 “No workspace here.” Both reviewed migration versions remain absent in fresh read-only migration history. No production mutation or activation occurred.

## Supabase recovery and migration answers

| Requirement | Prepared answer / remaining access |
| --- | --- |
| Canonical project | `kchtrvfcixnimvxxctkj`, organization `cfqfpnhjhpqjvtzgezrx`, PostgreSQL 17, us-west-1. Control-plane health does not establish Auth health. |
| Backup mechanism | Inventory an owner-accessible dated backup or perform a consistent logical export with PostgreSQL-compatible/Supabase tooling. Available metadata access does not provide a dump or prove a recoverable backup exists. |
| Restore ownership | Quota is cleared; project/database owner securely provides the canonical connection profile or recovery artifact and its scope/custody. Astra can install tooling and perform export/checksum/disposable restore once access exists. Credentials must remain protected. |
| Recovery scope | Inventory schema/data, roles/grants, RLS, functions, extensions, migration history, Auth and Storage metadata. Preserve Storage object bytes and relevant credentials separately. Restore only to an isolated compatible target; verify scope, row digests, policies and errors. A four-table dump or local SQLite backup is insufficient whole-project recovery. |
| Buyer prerequisites | Healthy Auth, proven recovery, reconciled current n8n writer and server identity, protected workflow version, documented rollback and prepared row/role/owner probes. |
| Nexus prerequisites | The same migration gate; include browser denial and real service reads, plus correlated zero-paid-call and zero-enrichment-write evidence for Nexus acceptance. |
| Reviewed migrations | Only `20260904201014_nexus_read_security.sql` and `20260904223151_buyer_browser_security.sql`; both remain unapplied. Rehash and apply transactionally only after gates clear. |
| Post-migration probes | Existing grant/RLS/policy and service `LIMIT 0` probes; quiescent before/after row counts/digests; actual owner/cross-owner sessions; real service capability reads; n8n management execution continuity. `LIMIT 0` proves permission resolution, not a real row read. |
| Rollback procedure | Failed migration transactions must leave no partial changes. After committed changes, retain tightened browser policies and repair the specific defect; do not regrant anonymous access or restore obsolete anonymous writer credentials. Application recovery uses only exact reviewed `2c0b600` after functional proof. Data restoration requires its own verified artifact and incident authority. |

Detailed access, restore procedure, migration digests and probe requirements: `/tmp/zola-resume-dependencies.md`. Prepared count/digest SQL: `/tmp/zola-resume-row-evidence.sql`; it has not queried production data. Snapshot equality alone cannot exclude transient writes.

## Current n8n writer

The actual current workflow, writer, recent executions, protected rollback version and authorized server identity remain UNVERIFIED. The owner must identify the actual management workspace/workflow or authoritative successor and grant protected management access. A webhook URL or historical archive cannot establish these facts.

Reconcile normal and failure paths for `SearchJob`, `RawSale`, `CleanSale`, `BuyerProfile` and `BuyerReport`, with `CountyDataSource` as a read dependency. Preserve the current version/checksum and credential references, inspect in-flight executions and authenticated intake, and establish an approved server writer before revocation. Do not invoke the webhook or attach broad server authority to unauthenticated intake.

## Six-read observations and runtime containment

The isolated runtime and all four caller URLs are already paired to exact recovery SHA `2c0b600c268faa0571f08322e16d7f81f37789be`. Inherited startup and generation-fence evidence remains PASS. Functional rollback remains NO and all six real reads remain NOT RUN.

The acceptance collector requires actual current database, ownership, transport and Nexus usage observations. Source checks, unit tests, stored booleans and an empty result without a database query cannot satisfy this gate. Buyer Matches must use an actual persisted deal with a resolvable county; otherwise an early empty response does not prove the Buyer database transport.

An additional source-conditioned mutation surface was identified and independently confirmed: Deal Analysis calls `listOutreachDraftRecords` even with `persistScaffold: false`. That helper checks operator scope and can create the outreach Storage bucket if scope is available and the bucket is missing. Its scope resolver maps an Auth-count error to zero and may use a configured default-user fallback. This is not proof that a production mutation occurred. Acceptance must establish the actual scope and include Storage bucket/object and API mutation observations; table-only snapshots are insufficient. The immutable recovery source was not changed.

The original rehearsal service lifetime is 180 seconds, shorter than the collector's worst-case six-read budget. A separate local supervision/lifetime draft is prepared for review before execution. It must pin exact isolated units and generation, bound the collector and observers, terminate owned descendants, stop worker then API, verify process/listener quiescence, restore only the isolated emergency flag and collect authoritative final observations after drain. It must never target canonical services. Drafts are not installed or executed; no runtime proof is claimed for them.

Keep every activation and merge gate held. After recovery and n8n access are resolved, establish real witnesses and authoritative observers, review the prepared supervisor against the actual environment, and execute the six tasks through the exact candidate. Mark rollback functionally verified only after all required runtime and six-read evidence passes.

## PRO backup availability and recovery-point verification

[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups), checked 2026-09-06, states PRO projects receive daily backups with seven-day retention. This is supported platform capability, not evidence that this newly upgraded project already has a usable dated backup. Inventory via the project Database > Backups dashboard or authenticated `GET /v1/projects/kchtrvfcixnimvxxctkj/database/backups`; record actual successful backup status/time/scope. PITR is a separate add-on and is not assumed enabled. Database backups exclude Storage object bytes and custom-role passwords; preserve those separately within the agreed scope.

With protected access, select a pre-migration recovery point or create a consistent logical export, identify its canonical project and scope, preserve checksum/custody where exportable, and restore only to an isolated compatible target. Compare schema, migrations, roles/grants, policies, required counts/digests and Auth scope; record errors and exclusions. Existing detailed procedure remains applicable. A PRO subscription, healthy Auth or a documented procedure alone cannot pass recovery. Current recovery result: UNVERIFIED; no restoration attempted.
