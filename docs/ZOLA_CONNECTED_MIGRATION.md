# Connected application migration transport

The connected Supabase `apply_migration` tool is available even when a native PostgreSQL administrator password is absent. `scripts/zola-connected-migration.js` prepares its exact request and validates sanitized history observations. It never sends SQL, activates services, merges a PR or establishes global release readiness.

The protected input contains exactly `releaseSha`, `providerManifest`, `manifestBytes`, `body`, and `expectedManifestSha256`, using the existing independently reviewed application package. The request is regenerated from source and rejects mismatched bytes. All modes require root, Node 22.23.1, a clean exact source checkout and protected files. Preparation and reconciliation can use a retained release checkout; claiming intent also verifies the current remote release head.

```sh
bash scripts/with-node.sh scripts/zola-connected-migration.js --prepare /absolute/protected/input.json /absolute/protected/new-request.json
```

The resulting JSON contains `request` with the fixed project, deterministic migration name and exact query, plus a fixed read-only `reconciliationQuery`. It contains no credentials or production rows. The caller must pass all global release gates, verify provider postconditions, coordinate the exclusive administration window, and persist `--claim` to a new evidence file immediately before invoking the connected tool once. The same durable release/body intent namespace is shared with the native executor. No alternate filename or transport permits another attempt.

The query establishes local timeouts before its outer `DO`, which asserts they survived within the API-owned transaction. It verifies the nonsuperuser `postgres` identity, acquires the same transaction advisory lock as the native executor, rejects existing native or connected history, and runs the exact reviewed body. That body checks provider ACLs, preserves exact row multisets and private writer authority, applies the two reviewed restrictions, and checks their postconditions. The query contains no `BEGIN` or `COMMIT`; the API owns its transaction and history version.

After success **or any uncertain response**, execute only the generated read-only reconciliation query through the connected SQL tool. Save its parsed rows as `{"rows": [...]}` in a protected JSON file; this object envelope follows the protected metadata reader's contract. Add `observationFile` to the input and run:

```sh
bash scripts/with-node.sh scripts/zola-connected-migration.js --reconcile /absolute/protected/reconcile-input.json /absolute/protected/new-result.json
```

Only one history row with the exact name and one byte-identical query digest passes; the actual API-generated version is returned. Wrong identity, a competing backend, rewritten/split SQL, duplicate or mismatched history all refuse acceptance. No history means `not-recorded-retry-not-authorized`, never permission to resend. A successful tool response alone is not committed evidence.

The disposable PostgreSQL 17.6 rehearsal verifies the envelope, modeled API transaction/history commit, row preservation, cross-transport duplicate rejection, timeout guard when transaction setup is split, and transaction abort when history insertion fails. It does not prove the actual Cloud endpoint's atomic history behavior. That contract remains an execution-time gate: unexpected history is retained and reconciled, never normalized into success or retried. The adapter does not replace the unfinished global release commander.

The transport maps to the official [Supabase MCP Management API implementation](https://github.com/supabase-community/supabase-mcp/blob/main/packages/mcp-server-supabase/src/platform/api-platform.ts), which sends `{name, query}` to the migrations endpoint and does not return the history version. Timeout placement follows [PostgreSQL 17 statement timeout semantics](https://www.postgresql.org/docs/17/runtime-config-client.html).
