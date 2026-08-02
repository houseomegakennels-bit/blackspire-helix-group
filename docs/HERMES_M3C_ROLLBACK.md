# Hermes Milestone 3C — Rollback

Scope: the implementation commits on `feature/hermes-memory-candidate-review-m3c`, on top of the
merged and anchored Milestone 3B baseline (`9dccdd95f5119195b192ee1f553b55d0eae3e48f`, reviewed head
`fd3ab87e4a8363699a11775301e50fb67d56fd44`).

## Scope of this branch's changes

- `packages/hermes-orchestrator/memory-review.js` — new. Review recording, replay, subject
  revalidation, digest verification, and the read service. Imports no router, executor, provider,
  health, memory, orchestrator, approvals, adapter, or scorecard surface.
- `packages/hermes-orchestrator/store.js` — additive reader/writer helpers for the new table plus a
  workspace-scoped pending-candidate reader. No update or delete helper exists for the new table, and
  deliberately no writer of any kind exists for `hermes_memory_candidates`.
- `scripts/migration-writer.js` — one additive, idempotent Milestone 3C schema block.
- `packages/shared/schema-validation.js` — registers the table, two unique indexes, and two
  immutability triggers.
- `apps/api/server.js` — one GET-only route, `/api/hermes/memory-candidate-reviews/:id`.
- `scripts/typecheck-check.js` — adds the new module.
- `tests/hermes-m3c-memory-review.test.js` — new, 18 tests.
- `docs/HERMES_M3C_MEMORY_CANDIDATE_REVIEW.md`, `docs/HERMES_IMPLEMENTATION_STATUS.md`,
  `docs/HERMES_INTELLIGENCE_LAYER_ARCHITECTURE.md`, this file — documentation.

## Not touched

Memory-candidate extraction (`memory.js` is unchanged), promotion (none exists), memory retrieval
(none exists), routing, provider selection, provider execution, provider health, approvals, task
execution, workflow orchestration, verified scorecards, the PWA, Telegram, the worker, Docker,
Vercel, CI, DNS, host configuration, release/Gate 4 scripts, `package.json`, and `package-lock.json`
(zero dependency changes). No environment variable was added or read by the new code. No entry was
added to `AUTHZ_PERMISSIONS`. No production, staging, shared, or real database was touched; all
fixtures are disposable SQLite files under a temporary directory.

## Second slice — re-review and successor chains

Scope: the implementation commits on `feature/hermes-memory-rereview-successor-m3c`, on top of the
merged and anchored first slice (`bf9072c5ebc1f195020e7c1709610c741cf8be43`, reviewed head
`1b589807af5d8179ad5b63e13648645dc2741d57`).

- `scripts/migration-writer.js` — one additive, idempotent schema block creating
  `hermes_memory_candidate_rereviews` with three unique indexes, two ordinary indexes, and two
  immutability triggers.
- `packages/shared/schema-validation.js` — registers the table, three unique indexes, and two
  immutability triggers.
- `packages/hermes-orchestrator/store.js` — additive insert and read helpers for the new table
  (chain, head, by id, by idempotency key). No update or delete helper, and still no writer of any
  kind for `hermes_memory_candidates`.
- `packages/hermes-orchestrator/memory-review.js` — `recordMemoryCandidateRereview`,
  `readMemoryCandidateRereview`, the chain internals, the inheritance allowlist and denied-key guard,
  and `MAX_REREVIEW_CHAIN_DEPTH`. No new import.
- `apps/api/server.js` — one GET-only route, `/api/hermes/memory-candidate-rereviews/:id`.
- `tests/hermes-m3c-rereview-successor.test.js` — new, 35 tests.
- `docs/HERMES_M3C_REREVIEW_SUCCESSOR_CHAINS.md`, `docs/HERMES_IMPLEMENTATION_STATUS.md`, this file —
  documentation.

The "not touched" list above applies unchanged, and no dependency, environment variable, or
`AUTHZ_PERMISSIONS` entry was added.

Rollback follows the identical procedure and the identical data rules below.
`hermes_memory_candidate_rereviews` is additive and append-only, inert after a code revert, and must
not be dropped or edited on any non-disposable database. Reverting it discards recorded human
judgements only; it cannot un-promote anything, because nothing was promoted — the root review table
and `hermes_memory_candidates` are byte-identical before and after any successor, which the suite
proves by table digest.

The migration block, the `schema-validation.js` registrations, and `memory-review.js` must move
together, for the same `assertSchemaCompatible` reason given below. The commits are otherwise ordered
so each can be reverted newest-first: tests, then the route, then the service, then the data layer.

## Rollback procedure

Shared-history rule: revert, never reset or rewrite.

1. Identify the range: `git log --oneline 54c1f1a..feature/hermes-memory-candidate-review-m3c`.
2. `git revert <commit>` for each implementation commit, newest first, on the affected branch.
3. Re-run, under canonical Node 22.23.1
   (`PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:$PATH bash scripts/with-node.sh scripts/run-tests.js`):
   the full suite, `npm run build`, `npm run lint`, `npm run typecheck`, `npm run security:scan`, and
   `npm audit --audit-level=high`.

Partial rollback: the documentation commit can be reverted independently. The implementation commit
cannot be split — the migration block, the `schema-validation.js` registrations, and
`memory-review.js` must move together, because a database migrated with the new table fails
`assertSchemaCompatible` at startup if the registrations are reverted alone, and a database migrated
without it fails if the registrations land alone.

## Data rollback

There is no destructive data rollback and none is required.

`hermes_memory_candidate_reviews` is additive and append-only. After a code revert it is inert:
nothing reads or writes it, exactly as the Milestone 3A and 3B tables behave. **Do not drop or edit
it on any non-disposable database.** Removing it would require a separately reviewed destructive
migration, and the immutability triggers deliberately refuse `UPDATE` and `DELETE`.

`hermes_memory_candidates` is unchanged by this milestone in both schema and content. Every candidate
remains `status='pending'` with `promoted_at IS NULL` before and after any review, which the suite
proves by byte-identical table digest. **A code revert therefore loses no promotion state, because
none was ever created.** Reverting 3C discards recorded human judgements only; it cannot un-promote
anything, because nothing was promoted.

Reverting the schema registrations without re-migrating is safe in one direction only: a database
that already has the new table validates fine against older code, because `findMissingSchemaObjects`
checks that required objects are present, not that extra ones are absent.

One forward-only consequence, matching the 3A and 3B precedent: a backup taken **before** this
migration is not restorable against post-3C code, because `scripts/restore.js` validates the backup
against the current required schema. Recover such a backup on a pre-3C checkout, or re-migrate after
restoring.

If any column is added to `hermes_memory_candidate_reviews` during review, note it here: the table is
created with `CREATE TABLE IF NOT EXISTS`, so a database migrated at an earlier commit of the branch
will not gain the column and will fail `assertSchemaCompatible` at startup. Recreate such disposable
databases.

## Operational rollback

No Telegram bot, provider, external service, Vercel project, DNS record, deployment, host control,
release, or trading system was changed, so no external rollback is required. Production remains
disabled and Gate 4 remains unauthorized; neither was touched by this branch.

## Review-repair commits on this branch

The review-finding repairs change application logic, tests, docs, and add
`scripts/mutation-test-m3c-rereview.js`. They add no migration, no column, no index, no trigger, and
no table, so the schema rollback above is unchanged and no additional data rule applies. Reverting
them restores the reviewed-but-defective read, replay, and depth behaviour described in "Corrections
from review" in HERMES_M3C_REREVIEW_SUCCESSOR_CHAINS.md; it does not require touching any database.
