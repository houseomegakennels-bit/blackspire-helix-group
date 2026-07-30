# Hermes Milestone 3B — Rollback

Scope: the implementation commits on `feature/hermes-verified-scorecards-m3b` (PR #60), on top of the
merged and anchored Milestone 3A baseline.

## Scope of this branch's changes

- `packages/shared/canonical.js` — new. `canonicalJson`/`digest`/`digestibleValue`, moved out of
  `outcome.js` with byte-identical function bodies.
- `packages/hermes-orchestrator/scorecard.js` — new. Derivation, replay, successor linking, and the
  read service.
- `packages/hermes-orchestrator/outcome.js` — imports the shared digest helpers instead of defining
  them privately; exports `evaluationIsIntact`. No behavioral change; every stored Milestone 3A
  provenance digest is unchanged, which the full 3A suite proves.
- `packages/hermes-orchestrator/store.js` — additive readers/writers for the two new tables plus
  `getRoutingDecision`. No update or delete helper exists for either new table.
- `scripts/migration-writer.js` — one additive, idempotent Milestone 3B schema block.
- `packages/shared/schema-validation.js` — registers the two tables, five unique indexes, and four
  immutability triggers.
- `apps/api/server.js` — one GET-only route, `/api/hermes/scorecards/:id`.
- `scripts/typecheck-check.js` — adds the new and previously unlisted modules.
- `tests/hermes-m3b-scorecards.test.js` — new, 14 tests.
- `docs/HERMES_M3B_VERIFIED_SCORECARDS.md`, `docs/HERMES_IMPLEMENTATION_STATUS.md`,
  `docs/HERMES_INTELLIGENCE_LAYER_ARCHITECTURE.md`, this file — documentation.

## Not touched

Routing, provider selection, provider execution, provider health, approvals, task execution,
workflow orchestration, memory candidates or promotion, the PWA, Telegram, the worker, Docker,
Vercel, CI, DNS, host configuration, release/Gate 4 scripts, `package.json`, and
`package-lock.json` (zero dependency changes). No environment variable was added or read by the new
code. No production, staging, shared, or real database was touched; all fixtures are disposable
SQLite files under a temporary directory.

## Rollback procedure

Shared-history rule: revert, never reset or rewrite.

1. Identify the range: `git log --oneline 159a429..feature/hermes-verified-scorecards-m3b`.
2. `git revert <commit>` for each implementation commit, newest first, on the affected branch.
3. Re-run, under Node 22.23.1: `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`,
   `npm run security:scan`, `npm audit --audit-level=high`.

Partial rollback: the documentation commit can be reverted independently. The implementation commit
cannot be split — the migration block, the `schema-validation.js` registrations, and `scorecard.js`
must move together, because a database migrated with the new tables fails `assertSchemaCompatible`
at startup if the registrations are reverted alone, and vice versa.

## Data rollback

There is no destructive data rollback and none is required.

`hermes_verified_scorecards` and `hermes_verified_scorecard_sources` are additive and append-only.
After a code revert they are inert: nothing reads or writes them, exactly as Milestone 3A's tables
behave. **Do not drop or edit them on any non-disposable database.** Removing them would require a
separately reviewed destructive migration, and the immutability triggers deliberately refuse UPDATE
and DELETE on both tables.

Note for anyone who migrated an intermediate commit of this branch: the review pass added two
columns (`known_retry_evaluations`, `unknown_timeout_count`) to `hermes_verified_scorecards`. Because
the table is created with `CREATE TABLE IF NOT EXISTS`, a database migrated at the earlier commit
will not gain them and will fail `assertSchemaCompatible` at startup. The branch is unmerged and
never deployed, so the only affected databases are disposable development ones; recreate them.

Reverting the schema registrations without re-migrating is safe in one direction only: a database
that already has the new tables validates fine against older code, because
`findMissingSchemaObjects` checks that required objects are present, not that extra ones are absent.

One forward-only consequence, matching the Milestone 3A precedent: a backup taken **before** this
migration is not restorable against post-3B code, because `scripts/restore.js` validates the backup
against the current required schema. Recover such a backup on a pre-3B checkout, or re-migrate after
restoring.

## Operational rollback

No Telegram bot, provider, external service, Vercel project, DNS record, deployment, host control,
release, or trading system was changed, so no external rollback is required. Production remains
disabled and Gate 4 remains unauthorized; neither was touched by this branch.
