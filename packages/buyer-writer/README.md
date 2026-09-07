# Scoped Buyer writer

This component is implemented and tested in isolation. It is not mounted in an
HTTP server, installed in production, or connected to the live n8n workflow.

`sql/install.sql` creates a private PostgreSQL permit, sale-evidence and receipt
ledger. The dedicated runtime can execute only the fixed write and receipt
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

`gateway.js` authenticates separate workload and permit credentials, rejects
duplicate credential headers, and invokes fixed parameterized statements through
an explicitly supplied dedicated runtime connection. The caller must use bounded
server-side statement/lock timeouts and a single autocommit statement. Do not
provide an admin pool or wrap calls in an uncommitted outer transaction. No
credential file, environment file, listener or database driver is loaded here.

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
node --test tests/buyer-writer-protocol.test.js tests/buyer-writer-gateway.test.js
```

The image must already be pulled. The harness uses PostgreSQL 17.6, synthetic
records, the exact reviewed Buyer restriction migration, and a non-superuser
CREATEROLE installer. It has no network, host mounts or production credentials.
Its private container data is tmpfs; cleanup removes only its verified container.
The fixture matches the exercised Buyer column and unique-key semantics, but is
not a full production database restore or the complete Nexus rehearsal.

Before deployment, finish authenticated issuer/intake integration, source-policy
validation, secure n8n HTTP credentials and execution handling, emergency-stop
integration, bounded HTTP transport, and the immutable rollback intake bridge.
Keep the old protected workflow snapshot available. Do not switch the live
workflow until its callers and the new writer have a reviewed coordinated path.
All release gates, including actual six-read acceptance, remain required.
