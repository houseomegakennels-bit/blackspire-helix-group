# ZOLA provider-owned ACL prerequisite

Status: request prepared for provider review. No provider message has been sent and no production ACL change has been applied.

## Request to Supabase Support

Project: `kchtrvfcixnimvxxctkj` (blackspire insight).

We are introducing separate least-privilege PostgreSQL writer identities. The current `postgres` account cannot revoke grants on objects owned by `supabase_admin`. Effective PUBLIC access to the objects below prevents the writer's privilege checks from passing. Please provide an authorized provider execution path or a supported extension change that removes this inherited authority while preserving current consumers.

Affected objects:

- `extensions.pg_stat_statements` and `extensions.pg_stat_statements_info`, owned by `postgres`.
- `net._http_response`, `net.http_request_queue`, and `net.http_request_queue_id_seq`, owned by `supabase_admin`.
- Twelve `net` functions, owned by `supabase_admin`: `_await_response`, `_encode_url_with_params_array`, `_http_collect_response`, `_urlencode_string`, `check_worker_is_up`, `http_collect_response`, `http_delete`, `http_get`, `http_post`, `wait_until_running`, `wake`, and `worker_restart`. Exact signatures are in the sanitized inventory.

Current extension versions: `pg_net` 0.20.4 and `pg_stat_statements` 1.11.

Required change contract (during a provider-controlled window with no concurrent ACL, role or extension changes):

1. Verify current object identity, signatures, owners, function-definition digests, extension versions, role memberships, schema ACLs and normalized object ACLs against fresh metadata before any mutation. Reject drift.
2. Preserve the effective privileges and existing grant options of the 32 currently captured roles. Replace each captured PUBLIC privilege with an explicit owner-granted privilege only where that owner-grantee-privilege edge is absent. Preserve every pre-existing edge and grant option, including PostgreSQL 17 `MAINTAIN`. Normalize NULL function ACLs using `acldefault('f', owner)`; the twelve currently NULL function ACLs include PUBLIC EXECUTE.
3. Exclude the new `buyer_writer_owner`, `buyer_writer_runtime`, and `buyer_writer_issuer` identities from these preserved-consumer grants. They must not inherit unrelated application-table, sequence or `net` function authority.
4. Revoke only the captured PUBLIC object privileges using the correct owning authority and `RESTRICT`. Do not change schema USAGE, ownership, object definitions, application data, or extension configuration as an incidental workaround.
5. Recheck effective privileges for every preserved role and verify every present writer identity has no unwanted access before committing. If those identities do not yet exist, absence is not acceptance: repeat mandatory denial checks immediately after provisioning. Do not invoke any `net` function or submit any network request to validate this change.
6. Make reapplication an exact-state no-op; reject partial or unexpected state. Provide a reversible change manifest identifying only the newly added grant edges. An ACL rollback must preserve previous direct grants and grant options. Do not restore unsafe PUBLIC authority while writer sessions remain usable.

All 65 live columns on the four affected tables/views currently have no column ACL entries. Recheck that condition before applying or rolling back: PostgreSQL table-level REVOKE also affects corresponding column privileges. [PostgreSQL 17 REVOKE documentation](https://www.postgresql.org/docs/17/sql-revoke.html)

Please confirm the authorized execution method and review the prepared manifest and exact apply/rollback transactions. The generator has passed an isolated PostgreSQL 17.6 ACL rehearsal; this does not establish provider execution authority or compatibility with a later changed catalog. Do not execute an unreviewed broad revocation or extension update.

## Sanitized attachment manifest

No credential values, production rows, connection strings or workflow exports are included.

| Attachment | SHA-256 |
| --- | --- |
| `/tmp/zola-writer-acl-normalized-20260907.json` — 17 objects, 32 roles, 22 membership edges | `7e4401ab286bf883253922a2787fff418790ccab97563c919bafe17944c519df` |
| `/tmp/zola-writer-acl-effective-20260907.json` — 1,504 effective/grant-option checks and 64 schema checks | `2f24d2985b8542d5be11ed3c3cd8b968ffe7e1b57138dd2b8692ddc76e46d9a2` |
| `/tmp/zola-writer-acl-columns-20260907.json` — 65 columns, zero column ACL edges | `908d24652d30edefa9e99e15c285629d6793387e1a4e594991739bec13dbfc0f` |

These captures are evidence, not authorization or executable SQL. Production execution must use fresh matching preconditions. The private writer SQL and reviewed Buyer/Nexus migrations remain separate and unapplied in production.

## Prepared transaction and isolated evidence

The offline generator is `packages/buyer-writer/extension-acl.js`; its read-only capture is `extension-acl-catalog.js`. It emits explicit owner grants, guarded PUBLIC revocations, exact-state reapplication and rollback transactions. Captured PostgreSQL version, roles, memberships, schemas, definitions and empty column ACLs are checked before and after changes. Separate collision-free dollar delimiters protect captured text independently of session string-escape settings.

Protected review package: `/tmp/zola-provider-acl-reviewed-KDmBB8` (not applied).

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `e32d0f4fd0aacdfee4a07245ca188e9365a9bc4b6b07a1328245a5708942599b` |
| `apply.sql` | `e15684752bf1a42f94e095e46924fff0b623f54f9213a4d9c76cc22cfe9edacc` |
| `rollback.sql` | `54ba84b6fa0bacfc802baefb1b2d2d6614bb7639dbca74f0cf662e3a4eb9505d` |

The manifest replaces 33 PUBLIC edges with 1,021 missing owner-granted consumer edges. `scripts/test-buyer-writer-acl.mjs` passes nine actual PostgreSQL checks: consumer/grant-option preservation, repeat apply, exact rollback, repeat rollback, enabled-writer rollback refusal, scoped-writer denial, column drift refusal, atomic rollback after an injected post-mutation exception, and unrelated-role drift refusal. The fixture also runs with `standard_conforming_strings=off` and adversarial captured column text.

Evidence: `/tmp/zola-acl-postgres-tests.log` and `/tmp/zola-acl-postgres-tests-budget.json`. The fixture used network-disabled disposable PostgreSQL with inert extension stand-ins; no actual extension network function, production credential or production row was used. Parent verification confirmed both the owned cgroup and container were absent afterward. This proves ACL transaction semantics, not production extension execution or complete writer/n8n continuity. The earlier failed syntax runs are retained as audit evidence.
