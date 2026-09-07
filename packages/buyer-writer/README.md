# Scoped Buyer writer

This component is implemented and tested in isolation. It is not mounted in an
HTTP server, installed in production, or connected to the live n8n workflow.

`sql/install.sql` creates a private PostgreSQL permit, sale-evidence and receipt
ledger. The dedicated runtime can execute only the fixed write, receipt and scoped context
routines; it cannot read Buyer tables, issue permits or assume the routine owner.
The separate issuer is a trusted backend authority. It must receive an operator
identity captured by the existing authenticated Buyer route, including its beta
or admin entitlement, before asynchronous work begins. A caller-supplied owner
UUID or a persisted job ID is not proof of authorization.

Each five-minute permit binds a job, owner, workspace, immutable criteria and
generation. Job locks serialize issuance, cancellation and writes. Operations
recheck ownership, criteria, generation and expiry after acquiring the lock.
Raw/clean provenance and lifecycle checks precede writes. Profile facts and
report snapshots are derived inside one transaction. Duplicate operations fail;
an uncertain network outcome must use scoped receipt lookup, never blind replay.
Database write failures roll back effects and persist a sanitized failure receipt
and failed job status where the database can still record them.

The issuer now requires an immutable source context instead of a caller-supplied
cash-scoring flag. It records ordered source IDs, reviewed endpoint policy IDs
and configuration digests, source request/row/byte budgets, and an optional raw
payload digest/count/byte count. PostgreSQL computes the context digest from its
JSONB serialization and derives `no_cash_data` from the source flags. The installer
removes the old boolean issuer signature; historical ledger rows are preserved,
but context-free permits cannot write. Cumulative raw rows respect the lower
context and frontend-payload row limits.

A scoped `context` endpoint returns only canonical criteria and source policy
references after successful start, while the same permit remains current and
unexpired. It rechecks ownership, criteria and state after acquiring the job lock.
`source-context.js` verifies exact UTF-8 raw JSON-array bytes before parsing or
normalization. That raw digest is distinct from the database's context digest and
normalized-sale provenance. Structural validation does not approve an endpoint:
the authenticated issuer and fetch executor still need the reviewed policy
resolver and source request/byte-budget enforcement. SQL does not prove that
normalized rows came from the bound raw bytes; the trusted execution path must
call the verifier before normalization.

`gateway.js` authenticates separate workload and permit credentials, rejects
duplicate credential headers, and invokes fixed parameterized statements through
an explicitly supplied dedicated runtime connection. The caller must use bounded
server-side statement/lock timeouts and a single autocommit statement. Do not
provide an admin pool or wrap calls in an uncommitted outer transaction. No
credential file, environment file, listener or database driver is loaded here.

`http.js` composes these adapters into an explicitly created, initially unbound
HTTP server. It authenticates before reading the body or checking availability,
matches only the three exact operation/receipt/context routes, bounds bodies and sockets,
and checks availability again after body collection. Disconnected database
operations retain their admission slot until settlement. Its availability hook
is not atomic fencing against a separate authority database. Deployment must
still provide the dedicated database pool, authoritative stop observation,
private listener/TLS ingress and bounded database connection/query timeouts.

`normalize.js` preserves the existing county field conversions and removes
ownership fields from the returned sales. ISO timestamps now retain their source
calendar date, matching PostgreSQL date input; epoch-based county conversions
already produce UTC dates. Date-only filtering is independent of host timezone.
Invalid dates and non-finite prices cannot be laundered into accepted writes.
`plan.js` validates the entire ordered write sequence before sending it, including
the exact eligible clean set, row/chunk/byte limits and detached payloads. Exact
duplicate rows reject the entire plan; this intentionally prevents legacy
duplicate counting rather than silently merging overlapping source records.
The SQL layer independently repeats authorization, provenance and lifecycle
checks. These helpers do not establish source-context authorization themselves.

`n8n-workflow.js` builds an offline replacement definition without reading the
old export or credential values. It references separate secure ingress/writer
credentials, authenticates the webhook, verifies bound bytes, bundles the pure
helpers for Cloud Code nodes, and sends fixed HTTP operations through a sequential
receipt loop. Known pre-write verification failures produce a scoped failure
operation; only a complete matching receipt sequence permits success. Redirects,
automatic retries, execution saving and pinned data are disabled. This is not a
published workflow or proof of actual Cloud execution/item linking.

The candidate accepts only frontend-prefetched payloads, capped at 6 MiB decoded
and transported as canonical base64, and requests a 90-second execution timeout.
The trusted issuer must apply the same limits before issuance. County fetching
must be moved into the bounded authenticated server path first. Workload timing,
Cloud execution and timeout reconciliation remain required: transport/context
errors can leave a processing job with an unknown outcome and require scoped
receipt lookup rather than blind replay. Saving controls do not establish absence
from all transient Cloud storage. The returned definition includes empty pinData;
publishing must use the current management API's accepted projection and verify
actual pinning/settings rather than assuming export shape equals update shape.

The installer is separate from the already-reviewed Buyer/Nexus migrations. It
does not provision login passwords or revoke the legacy browser grants itself.
Its managed installer needs CREATEROLE, ownership of the five Buyer tables and
schema creation authority. The NOLOGIN routine owner has only the required
public column grants. PostgreSQL 17 creator ADMIN membership is accepted only
for the trusted installer; runtime and issuer cannot inherit or assume other
roles. Unexpected namespaces, role privileges and reachable external privileged
functions are rejected. Future privilege drift still requires operational audit.
Ordinary PUBLIC database facilities are not claimed to be completely revoked.

Run the isolated database acceptance with Node 22.23.1 and Docker:

```bash
env -i PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin \
  BUYER_WRITER_TEST_IMAGE=postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94 \
  node scripts/test-buyer-writer-postgres.mjs
node --test tests/buyer-writer-protocol.test.js tests/buyer-writer-gateway.test.js tests/buyer-writer-http.test.js
node --test tests/buyer-writer-plan.test.js tests/buyer-writer-source-context.test.js
```

The image must already be pulled. The harness uses PostgreSQL 17.6, synthetic
records, the exact reviewed Buyer restriction migration, and a non-superuser
CREATEROLE installer. It has no network, host mounts or production credentials.
Its private container data is tmpfs; cleanup removes only its verified container.
One group sends actual loopback HTTP through the gateway into the dedicated
database login, using test-only prepared psql calls, and verifies all five tables.
The fixture matches the exercised Buyer column and unique-key semantics, but is
not a full production database restore or the complete Nexus rehearsal.

Before deployment, finish authenticated issuer/intake integration, source-policy
validation, secure n8n HTTP credentials and execution handling, emergency-stop
integration and the immutable rollback intake bridge.
Keep the old protected workflow snapshot available. Do not switch the live
workflow until its callers and the new writer have a reviewed coordinated path.
All release gates, including actual six-read acceptance, remain required.
