# Hermes Milestone 3B — Verified Scorecards Contract

Milestone 3B derives deterministic, append-only scorecard snapshots from intact Milestone 3A
factual evaluations. A scorecard is a read model for learning quality, not an execution control.
Nothing in this milestone may change routing, provider selection, task execution, approvals,
memory-candidate status, or production behavior.

## First vertical slice

The first implementation slice is workspace-scoped and explicit:

1. Select terminal M3A evaluations up to a caller-supplied canonical cutoff tuple
   `(created_at, id)`.
2. Revalidate every selected evaluation's immutable provenance before aggregation.
3. Group only by canonical workspace, provider, agent, capability, and classification dimensions.
4. Derive integer counts and known totals without averages that silently discard unknown values.
5. Persist a new immutable snapshot and its ordered source lineage in one transaction.
6. Return the stored snapshot; never call the router, executor, provider registry mutation surface,
   or memory service.

There is no background job, startup hook, workflow-completion hook, historical backfill, HTTP
mutation route, PWA control, or automatic refresh in the first slice. Creation is an explicit
development/test service call against disposable state.

## Deterministic evidence rules

- Source ordering is `(evaluation.created_at, evaluation.id)`. The cutoff uses that same tuple so
  equal timestamps cannot make membership nondeterministic.
- A source is accepted only when its M3A evaluation, components, provenance digest, terminal matrix,
  and current append-only correction/source-event lineage validate. A missing or contradictory
  source fails the whole snapshot; it is never skipped.
- Repeated source evaluation IDs, cross-workspace sources, mixed scorecard versions, future
  timestamps, malformed dimensions, integer overflow, and redaction failures fail closed.
- Replay of an identical scope, cutoff, version, and ordered lineage returns the existing snapshot.
  The same identity with different derived content is an integrity error.
- The lineage digest covers the scorecard version, exact scope/dimensions, cutoff, every ordered
  evaluation ID and provenance digest, the selected correction head, ordered source-event IDs, and
  every persisted metric.
- Snapshot and lineage rows are database-enforced append-only. Recalculation creates a successor;
  it never updates a prior snapshot.

## Metrics and unknown handling

`m3b-v1` stores factual integer counts:

- total source evaluations;
- completed-and-verified positive-eligible evaluations;
- negative terminal evaluations;
- blocked/ineligible evaluations;
- known accepted, rejected, partially accepted, rollback, stability-confirmed, and
  regression-linked event counts;
- evaluations with unknown acceptance, rollback, or stability;
- retry, timeout, and cancellation counts;
- known input tokens, output tokens, cost cents, and the count of evaluations contributing each
  known total.

Unknown is a first-class count, never zero and never success. Ratios are derived only when their
denominator is explicit and nonzero, and their stored representation must be exact integer
numerator/denominator fields rather than floating-point values.

The proposed `m3b-v1` evidence confidence bands are deterministic and policy-visible:

- `insufficient`: fewer than 5 intact source evaluations;
- `limited`: 5 through 19 intact source evaluations;
- `established`: 20 or more intact source evaluations.

These labels describe sample size only. They do not authorize routing, memory promotion, or a
claim that a provider or agent is good.

## Isolation and authorization

Every query derives workspace from stored M3A evidence. Callers cannot supply a workspace that
overrides source scope. Snapshot reads will reuse canonical `evaluation.read`; explicit snapshot
creation will require a separately reviewed permission before any API integration. The first slice
has no HTTP route and runs only in disposable development/test fixtures.

## Acceptance gates

- Same sources in any input order produce byte-identical metrics and lineage digest.
- Cutoff boundaries, equal timestamps, replay, successor lineage, and integer overflow are pinned.
- Fewer than 5, exactly 5, exactly 19, and exactly 20 sources produce the documented confidence.
- Unknown acceptance/rollback/stability cannot become false zero or positive evidence.
- Cross-workspace, malformed, missing, duplicated, corrected, and contradictory evidence fails
  closed.
- Database triggers refuse snapshot and lineage update/delete.
- Tests prove route decisions, provider health, approvals, workflow runs/steps, memory candidates,
  and promoted-memory tables are byte-identical before and after derivation.
- Full repository validation, secret scan, zero-vulnerability audit, migration/restore checks,
  exact-head remote checks, and independent correctness/security review pass before merge.

## Implemented surface

The first slice is implemented in `packages/hermes-orchestrator/scorecard.js`, persisted through
`packages/hermes-orchestrator/store.js`, and pinned by `tests/hermes-m3b-scorecards.test.js`.

`deriveVerifiedScorecards(principal, { workspaceId, cutoff, scorecardVersion })` is an explicit
service call with no HTTP mutation route, no background job, no startup or workflow-completion hook,
no historical backfill, and no automatic refresh. It returns one immutable snapshot per dimension
group. `readVerifiedScorecard(principal, scorecardId)` is the only read, exposed over HTTP as
`GET /api/hermes/scorecards/:id`.

Two additive tables carry the model:

- `hermes_verified_scorecards` — one immutable snapshot per `(workspace, scorecard version, provider,
  agent, capability, classification, cutoff)` identity, with `scope_version` and
  `supersedes_scorecard_id` forming a linear successor chain, plus `lineage_digest` and
  `content_digest`.
- `hermes_verified_scorecard_sources` — the ordered lineage, one row per source evaluation, keyed by
  an explicit gap-free `seq` and carrying that source's provenance digest, selected correction head,
  and ordered source-event ids.

Both tables are database-enforced append-only through `trg_hermes_scorecards_immutable_*` and
`trg_hermes_scorecard_sources_immutable_*`. All four dimension columns are `NOT NULL` and use the
sentinel `*`, which lies outside the canonical id character set: SQLite treats NULLs as distinct in a
UNIQUE index, so a nullable dimension would silently permit duplicate snapshots for one scope.

`canonicalJson`/`digest` moved to `packages/shared/canonical.js` with byte-identical bodies so
Milestone 3A and 3B share exactly one digest algorithm and every stored 3A provenance digest is
preserved. `evaluationIsIntact` is exported from `outcome.js` so "intact" has one definition rather
than two that can drift.

## Derivation rules (`m3b-v1`, `hermes-scorecard-derivation-v1`)

1. Selection is `workspace_id` plus the cutoff tuple, ordered `(created_at, id)` and inclusive at the
   boundary. Selection deliberately does **not** filter on `evaluation_version`: filtering it in SQL
   would turn a mixed or tampered version into a silently skipped row, so every row in scope is
   selected and a non-canonical version fails the snapshot closed.
2. Every selected source is revalidated through `evaluationIsIntact` — shape, provenance digest
   against live evidence, correction chain, and source-event lineage.
3. A source that fails any check fails the whole snapshot. Sources are never skipped, because
   silently dropping evidence would make a scorecard look better than the record supports.
4. A corrected source is disputed evidence and fails closed rather than being aggregated.
5. Dimensions come from the source's own immutable evidence: provider from the evaluation, agent from
   its routing decision, capability from the canonical sorted `requiredCapabilities`, classification
   from the four scalar facets re-emitted through `canonicalJson` so key order cannot vary.
6. Contradictory acceptance evidence — an `accepted` event alongside a `rejected` or
   `partially_accepted` event on one evaluation — fails the snapshot closed rather than being
   resolved in the favorable direction.
7. Metrics are exact integers. Unknown is counted in its own column and never folded into zero or
   read as success. This includes `unknown_timeout_count` (an evaluation with no provider invocation
   at all, which Milestone 3A itself records as an unknown timeout even though the NOT NULL column
   reads `0`) and `known_retry_evaluations` (the explicit denominator for `retry_total`, since a
   NULL `retry_count` is unknown, not zero retries). Ratios are integer numerator/denominator pairs;
   a zero denominator means the ratio is not derivable, not that it is zero.
8. Confidence is sample size only: `insufficient` under 5, `limited` 5–19, `established` 20 or more.
9. The lineage digest covers the version, exact scope and dimensions, cutoff, every ordered
   evaluation id and provenance digest, each correction head, ordered source-event ids, and every
   persisted metric. Neither the snapshot id nor its wall-clock creation time is hashed.
10. Replay over an identical identity returns the stored snapshot without writing. An identical
   identity whose derived content differs is an integrity error, never an overwrite.
11. Sorting within this module is by UTF-16 code unit, never `localeCompare`, whose result depends
    on host ICU data. Note that revalidation still calls into Milestone 3A, which sorts component
    rows with `localeCompare`; that is pre-existing 3A code and no ordering inversion exists among
    its fixed ASCII component names, but the guarantee is this module's, not the whole path's.

## Authorization and read surface

Reads reuse the canonical `evaluation.read` permission. Derivation persists rows, so it additionally
requires the write-capable `evaluation.correct`: a read-only `viewer` grant must not be able to
append permanent, immutable snapshots. No new permission was added to `AUTHZ_PERMISSIONS`.

Authorization runs *before* the transaction opens, matching Milestone 3A's correction path, so the
audited allow/deny decision survives the rollback that any later refusal triggers — scope probing
cannot be silent. It is re-proved inside the transaction without emitting a second audit row, so one
logical operation records one decision per permission. It is checked against the
caller-named workspace before any evidence is read, and every selected source must already belong to
that workspace, so a caller can neither widen scope nor override the scope stored in evidence. The
HTTP route reuses `configuredEvaluationAdminPrincipal` and the existing session/bearer binding
unchanged, is GET-only, is absent from `isPublicAsset` and from the test-mode allowlist, and returns
`404` for both an unknown id and a cross-workspace object so the two are indistinguishable.

## Failure observability and operations

Migrations stay additive and idempotent and publish atomically inside the existing single
transaction. The new unique indexes and immutability triggers are registered in
`packages/shared/schema-validation.js`, so startup and restore validation fail closed when
integrity-critical structure is missing. A backup taken before this migration is not restorable
against post-3B code — this matches the 3A precedent; recover such a backup on a pre-3B checkout or
re-migrate. Rollback is code rollback: see `docs/HERMES_M3B_ROLLBACK.md`.

## Status and limitations

Implemented and validated at the exact head. Known limitations, all deliberate:

- **Physical deletion is undetectable.** Selection is "every evaluation in scope", and there is no
  independent manifest of what should exist, so a row physically removed from the database is
  indistinguishable from one never written. Deletion is impossible through the application; it
  requires dropping the immutability triggers. The same applies to reassigning a source row's own
  `workspace_id`, which removes it from the query scope entirely.
- **Integer overflow is guarded but structurally unreachable.** `safeSum` refuses any non-exact
  addition, but Milestone 3A already refuses usage overflow at evaluation time, so intact evidence
  cannot reach the guard. It is not covered by a test that exercises the throw.
- **Rollback, stability, and acceptance are unknown for all current evidence.** Milestone 3A never
  records those determinations on the evaluation row, so they are counted as unknown unless an
  explicit append-only source event exists.
- **Registry drift breaks re-derivation.** Revalidation re-runs registry routing against the live
  registries, so editing a registry entry makes older evaluations unreadable and a previously
  successful snapshot non-reproducible. Registry definitions must be treated as immutable during 3B.
- **A non-fixed-width `created_at` is silently excluded, not refused.** Timestamp canonicality is
  checked only on rows the selection query already returned, so a row tampered to e.g.
  `2026-01-01T00:00:00Z` sorts outside the cutoff and drops out of scope with no error. Same
  trigger-dropping precondition as physical deletion.
- **Derivation is unbounded.** `selectSources` has no `LIMIT` and each source runs a full provenance
  re-derivation, all inside one `BEGIN IMMEDIATE` transaction that blocks other writers. One call is
  O(entire workspace history) and writes one row per distinct dimension group. This is acceptable
  only because there is no derivation route; a future API integration must bound it.
- **Digest verification is corruption detection, not tamper resistance.** Both digests are unkeyed
  SHA-256 over fully persisted public inputs, so an actor who can already write to these tables
  (which requires dropping the immutability triggers) can recompute them to match an edit. No later
  milestone may treat this as an integrity control against a database-write adversary.
- No `follow_up_verification` semantics beyond a raw count; it is stored but not interpreted.

Nothing here activates learned routing, memory promotion or retrieval, provider execution,
deployment, production, or Gate 4.

## Deferred after 3B

Approval-gated memory-candidate review/promotion, scorecard-informed learned routing, rollback of
learned routing, broader provider/agent registry work, verified human identity, operator PWA,
Telegram/voice integration, live providers, production deployment, and Gate 4 remain separate
dependency-ordered milestones.
