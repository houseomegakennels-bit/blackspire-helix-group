# Hermes Intelligence Layer — Implementation Status

## Cross-cutting schema CHECK validation (implemented, in review)

- The shared startup/restore/migration gate now pins all 52 authorization and Hermes 3A-3C CHECK expressions as an exact normalized multiset.
- Disposable mutations prove enum widening, numeric weakening, constraint removal, `promote` admission, and re-review chain-shape weakening fail closed. No schema or data is rewritten automatically.
- Node 22.23.1 validation passes focused 30 with one root-only permission skip and full 704 total, 695 passed, 0 failed, 9 host-conditional skips. Independent review, merge, deployment, and production effect are not yet claimed.

## Milestone 3A read-path authorization ordering (implemented, in review)

- `readOutcomeEvaluation` now authorizes the stored workspace before complete provenance validation or subordinate-evidence reads, matching M3B and M3C.
- Absent, unauthorized, and non-intact evaluations still return `null`; callers cannot nominate a workspace, and same-workspace reads still require `evaluation.read`.
- The oracle is **narrowed, not closed**. Object-scaled work now sits behind the deny, but authorizing an existing row costs more than returning early on an absent one, so a residual absent-vs-exists signal survives. Independent reviewers measured that residual at **~45x to ~77x on this host** across five independent reviewers under differing load, against pre-fix baselines ranging from ~119x to ~302x measured the same way; both ends depend on the fixture as well as the host, because the pre-fix path walks the correction chain and its cost grows with the correction count, so a figure quoted without its fixture is not reproducible; the ratio is host- and load-dependent and no single figure should be quoted as a constant. Every measurement agrees on the direction and rough magnitude: the leaked work is roughly halved (one reviewer computed 59% removed where an earlier round had said "roughly 70%" — that earlier figure is not reproducible and is withdrawn). It names no workspace and matches the residual already accepted for M3C; it is carried as follow-up (viii).
- The read-ordering regression is pinned three ways, and the load-bearing guard is behavioural rather than textual. **Two earlier claims on this line were false and are retracted.** The first said the source-text pins covered work confined to the components or workflow-evidence tables; they do not, and being source-text matchers they cannot be made to — four mutants evade them while doing identical pre-authorization work (a string literal containing `//` that the comment stripper then erases to end of line, a one-line alias function, an alias held in a lookup object, and a bare `loadEvidence` behind the same string trick). The second said the second behavioural guard closed that gap "independent of source shape". Source shape was never the axis that mattered: **table coverage** is. Two independent exact-head reviewers each showed that a bare, unobfuscated `getWorkflowSteps(evaluation.run_id)` ahead of the deny — an already-imported accessor under its real name, needing no evasion at all — survived at 21/21, because the guard's sentinel set named only two of the relations the integrity path reads. A source-text assertion, bounded to the function body and stripped of comments, is retained only as a fast first failure and is **not** coverage. Behavioural guard 1 hides `hermes_outcome_corrections` and `hermes_outcome_source_events` so a pre-authorization read of either throws, which cannot reach work `provenanceMatches` swallows in its own try/catch. Behavioural guard 2 swaps every **object-scaled** relation `readableEvaluation` can reach for views over the real tables whose `WHERE` clause calls a UDF recording the access, so a pre-authorization touch is *observed* rather than needing to throw. **A previous revision of this line claimed the eight-relation set covered "every relation the integrity path can read"; that was false and is retracted.** It omitted `hermes_outcome_corrections` and `hermes_outcome_source_events`, which `readableEvaluation` reads directly, and two independent reviewers each showed that a raw-SQL read of either inside a mutant-local `try { ... } catch {}` survived at 21/21 — guard 1's throw was swallowed, guard 2 had no sentinel, and raw SQL keeps the accessor names away from the source-text pin. The set is now the ten relations reached by walking `readableEvaluation` into `provenanceMatches`, `loadEvidence`, `correctionChainValid`, and `sourceEventsValid`: `hermes_workflow_runs`, `hermes_workflow_steps`, `hermes_routing_decisions`, `hermes_policy_decisions`, `hermes_verification_results`, `hermes_provider_invocations`, `tasks`, `hermes_outcome_evaluation_components`, `hermes_outcome_corrections`, and `hermes_outcome_source_events`. `hermes_outcome_evaluations` and the `auth_*` tables are deliberately excluded and documented as such in the test: the first is read before authorization by design to supply the workspace being authorized, the rest are read by `canReadEvaluation` itself, and all are constant-cost rather than evidence-scaled. **A stated limit of the mechanism:** the recorder fires from a view's `WHERE` clause, which SQLite evaluates per row, so it observes a relation only when that relation has at least one row. Extending the set to the correction and source-event tables therefore required the guard's fixture to create a correction and a source event, with explicit assertions that those rows exist — without them both sentinels would have been silently vacuous. A pre-authorization read of an empty relation leaks nothing that scales with the object and is outside what this guard is built to catch. Twenty-eight mutants were executed against the set and all twenty-eight fail the test (21 tests, 20 pass, 1 fail each); the unmutated head passes 21/21.
- Round 6 supersedes the paragraph's final ten-table-set claim: a raw read of populated `hermes_memory_candidates` survived because that table was not manually named, so the guard now discovers user tables from the disposable runtime schema. Round 8 removes the remaining blanket auth-table exclusion: a direct `canReadEvaluation` call establishes exact per-relation authorization read counts, and the denied evaluation read must match them. A reproduced pre-denial `recordedActorValid` call fails on the additional auth-graph read. Only the evaluation identity lookup and authorization audit write are excluded from instrumentation. Partial setup/restoration tracks every altered table, attempts all cleanup, and combines restoration errors with rather than hiding the primary failure. Node 22.23.1 focused validation passes. Fresh independent review, merge, deployment, and production effect are not yet claimed.

## Milestone 3C, second slice — Re-review and successor chains (PR #64, merged)

- **Implemented:** additive, idempotent, append-only `hermes_memory_candidate_rereviews` with database-enforced immutability triggers; a re-review modelled as an explicit successor that links to the record it supersedes and never overwrites it; database-enforced chain shape (`UNIQUE(root_review_id,chain_version)` against forks at every depth including the first successor, `UNIQUE(supersedes_rereview_id)` against forks off a successor, a depth/parent CHECK against ambiguous ancestry, and self-link CHECKs); a required `supersedes` that must name the chain's current head, so a stale or conflicting predecessor refuses and two concurrent re-reviewers resolve to one winner and one explicit refusal rather than a fork; ancestry verified all the way to the root rather than one hop, because a predecessor's own digests do not cover its `supersedes_rereview_id`; a predecessor content/lineage digest pin; deterministic `chain_version` ordering and replay; workspace-scoped idempotent replay with integrity-conflict detection; a bounded chain depth enforced on both write and read; and a read-only service plus one GET route reusing canonical `evaluation.read`.
- **No inherited authority:** a successor inherits no approval, correctness, scorecard result, authorization, or promotion eligibility from its predecessor. Decision and rationale are supplied fresh by the caller, the write-capable `evaluation.correct` is required per call and re-proved in-transaction against current grants, and the candidate is revalidated from scratch against live Milestone 3A evidence. Carried context is an explicit identity-only allowlist, copied safely and provenance-tracked, enforced on write and re-enforced on read by a **positive allowlist** that pins the exact block shape and requires every carried leaf to strict-equal the row's own identity column. The denied-key guard is **not** symmetric with it, and nothing rests on it: the write-path call is unreachable because the block is assembled from frozen literals, and the read-path call is unreachable behind the allowlist. Both are reported as declared equivalent mutants, not as enforced runtime invariants.
- **Ordering:** `chain_version` is the **sole ordering authority** for a successor chain — unique per root, therefore a total and replay-stable order, and the order `getMemoryCandidateRereviewChain` reads by. `created_at` is **metadata only**: it is millisecond-resolution, ties are routine, and it carries **no causal or ordering guarantee**. No integrity check derives order from it, and a write-path monotonicity check was removed rather than kept, because the read path loads one row and its ancestry and never sees the sibling ordering such a check would police. This deliberately **differs** from the Milestone 3B scorecard chain, which selects by a `(created_at, id)` cutoff tuple; the two milestones do not share an ordering shape and must not be described as if they do.
- **Isolation:** a successor's workspace and candidate are bound to the root's on read, the predecessor head's are re-verified on append, and the live candidate must belong to the same workspace as the chain. `workspace_id` is deliberately not covered by either digest, so these explicit bindings are what catch a forged workspace.
- **Review-only:** the decision vocabulary is unchanged and still contains no `promote` value, enforced by a database CHECK. No writer of any kind exists for `hermes_memory_candidates`. No promotion, memory retrieval, routing, provider, backfill, or production effect; Gate 4 untouched.
- **Next:** the workspace-scoped review queue, then promotion. Promotion must not reuse `evaluation.correct` as its authority without an explicit decision.

Details: `HERMES_M3C_REREVIEW_SUCCESSOR_CHAINS.md`. Rollback: `HERMES_M3C_ROLLBACK.md`.

## Milestone 3C, first slice — Approval-gated memory-candidate review (PR #62, merged)

- **Implemented:** additive, idempotent, append-only `hermes_memory_candidate_reviews` with database-enforced immutability triggers, a UNIQUE one-review-per-candidate identity, and workspace-scoped idempotency keys; deterministic `m3c-v1` recording of a human decision over one pending Milestone 1 memory candidate, revalidated against intact Milestone 3A evidence in the same workspace; a `candidate_digest` that pins the candidate row as it read at decision time; content and lineage digests verified on every read; idempotent replay that returns the stored review and raises an integrity conflict on divergence; and a read-only service plus one GET route reusing canonical `evaluation.read`.
- **Review-only:** the decision vocabulary is `recommend_promote`, `reject`, `defer_needs_evidence` and contains no `promote` value, enforced by a database CHECK. Nothing reads a review in `m3c-v1`. `hermes_memory_candidates.status` and `promoted_at` are never written, and no update or delete path for that table exists anywhere; tests pin both by byte-identical table digest and by source scan. No memory promotion, no memory retrieval, no learned or scorecard-informed routing.
- **Authorization:** reads reuse `evaluation.read`; recording persists immutable rows and additionally requires the write-capable `evaluation.correct`. No new permission and no new environment variable. Both audited decisions precede the transaction so a denial survives rollback, and are re-proved non-auditing inside it. On the read path authorization precedes all integrity work. Workspace scope always comes from the stored candidate row, never from a caller.
- **Next:** re-review/successor chains (the second slice above), a workspace-scoped review queue, then promotion — each a separate dependency-ordered milestone. Promotion must not reuse `evaluation.correct` as its authority without an explicit decision.

Details: `HERMES_M3C_MEMORY_CANDIDATE_REVIEW.md`. Rollback: `HERMES_M3C_ROLLBACK.md`.

## Milestone 3B — Verified scorecards (PR #60, merged)

- **Implemented:** additive, idempotent, append-only `hermes_verified_scorecards` and `hermes_verified_scorecard_sources` with database-enforced immutability triggers, a UNIQUE snapshot identity, a linear successor chain, and an explicit gap-free lineage `seq`; deterministic `m3b-v1` derivation from intact Milestone 3A evaluations only, selected by the canonical `(created_at, id)` cutoff tuple and revalidated per source through the single exported definition of "intact"; exact integer metrics with unknown as a first-class count and ratios stored as integer numerator/denominator pairs; sample-size-only confidence bands (`insufficient` under 5, `limited` 5–19, `established` 20 or more); a lineage digest over version, scope, cutoff, ordered sources, correction heads (reserved; structurally always NULL in `m3b-v1`, since a corrected source refuses the snapshot outright), ordered source-event ids, and every persisted metric; idempotent replay that distinguishes legitimately appended Milestone 3A source evidence (resolved by deriving a later cutoff) from a genuine integrity conflict; a cutoff-monotonicity guard so a successor can never regress a scope to an earlier cutoff; structural verification of `scope_version` and `supersedes_scorecard_id` against the real predecessor on every read, since those fields are assigned at insert time and cannot be hashed without breaking replay; fail-closed handling of mixed versions, corrected, cross-workspace, malformed, and contradictory evidence, out-of-enum classification facets, and non-four-digit-year cutoffs.
- **Authorization:** reads reuse the canonical `evaluation.read` permission; derivation persists immutable rows and therefore additionally requires the write-capable `evaluation.correct`, so a read-only viewer grant cannot append snapshots. No new permission and no new environment variable is introduced. On the read path authorization is decided before any lineage or digest work, so an unauthorized caller cannot measure a scorecard they hold no grant for. Authorization is checked exactly once per derivation against the caller-named workspace before any evidence is read, and every source must already belong to it, so caller input can neither widen scope nor override the scope stored in evidence. The GET-only `/api/hermes/scorecards/:id` route reuses the existing principal binding unchanged and returns `404` for both unknown and cross-workspace ids.
- **Operational guarantees:** additive atomic migration, required integrity indexes/triggers registered for startup and restore validation, disposable-only fixtures, no HTTP mutation route, no background job, startup hook, workflow-completion hook, historical backfill, or automatic refresh. Tests prove routing, provider, approval, workflow, and memory-candidate tables plus the whole schema are byte-identical before and after both successful and refused derivation. No routing effect, no memory promotion/retrieval, no live provider, no production activation; Gate 4 untouched.
- **Next:** approval-gated memory-candidate review and promotion, then scorecard-informed learned routing. Both remain separate dependency-ordered milestones.

Details: `HERMES_M3B_VERIFIED_SCORECARDS.md`. Rollback: `HERMES_M3B_ROLLBACK.md`.

## Milestone 3A — Verified outcome evidence (PR #57, merged)

- **Implemented:** one immutable factual evaluation per terminal run/version; complete canonical provenance digest over exact, sanitized, causally bounded routing, policy, verification, every provider attempt, workflow-step, evaluation, and component evidence; exact terminal outcome matrices; registry-derived routing identity with the original requested-provider opt-in independently persisted on the workflow run and non-registry values refused before persistence; canonical stored classification derived from route/step evidence; deterministic retry/usage/timeout/cancellation aggregation; database-enforced append-only evaluations, components, corrections, source events, and failure records.
- **Authorization:** evaluation reads derive stored workspace scope and require current `evaluation.read`; corrections/events require current `evaluation.correct`. Server-bound canonical admin sessions and bearer auth can use the narrow read path; forged, stale, malformed, cross-workspace, and unbound contexts fail closed. Service authentication always requires its exact credential reference.
- **Operational guarantees:** additive atomic migration, required integrity indexes/triggers, disposable-only provisioning/tests, strict production CSP, no routing or scorecard effect, no memory promotion/retrieval, no live provider, no production activation.
- **Next:** delivered by Milestone 3B above (verified scorecards, non-operative). Approval-gated memory promotion and learned routing remain later milestones.

Details: `HERMES_M3A_OUTCOME_SCORING.md`.

## Milestone 2 — Runtime & Provider Framework (merged via PR #56)

Development-only real-provider runtime, additive on M1. Mock remains the default; real execution is
disabled by default and refused under the production profile. First real adapter: **Anthropic
Messages API (non-agentic Claude)** — chosen over the agentic Claude Code CLI as materially safer
(pure text I/O, no shell/agent surface), approved by the operator.

- **Implemented + tested:** runtime-profile gate, typed provider/capability registries, Anthropic dev adapter, deterministic fake provider, real/mock execution flow (timeout, cancellation, retry ceiling, concurrency limit, size limits, budget/cost ceiling, no silent real→mock fallback), scoped single-use approvals, provider health/cooldown, usage/cost recording (null-safe), read-only `/api/hermes/runtime` + `/hermes-runtime` PWA page. 3 new additive tables (`hermes_provider_invocations`, `hermes_provider_health`, `hermes_approvals`).
- **Tested with fixtures only:** the real adapter is exercised via the fake provider; no paid call in the suite.
- **Awaiting live smoke test:** `scripts/hermes-dev-smoke.js` prepared but disabled (requires explicit operator opt-in).
- **Deferred beyond M2:** verified scorecards, learned/multi-provider routing, approval-gated memory promotion, cross-host limits, pricing→cost.
- **Prohibited in production:** all real (and even mock) Hermes-runtime execution is refused under the production profile.

Details: `HERMES_M2_RUNTIME_AND_PROVIDERS.md`.

---



Branch: `feature/hermes-intelligence-layer-m1`. Scope: **Milestone 1 only.** Mock-only, additive,
reversible. No production activation, no real providers, no Telegram, no voice.

## Implemented (Milestone 1)

| Component | Module | Notes |
| --- | --- | --- |
| Orchestrator service boundary | `packages/hermes-orchestrator/orchestrator.js` | `runHermesWorkflow(input)` |
| Task normalization contract | `normalize.js` | validated `NormalizedTask`, reuses canonical ids |
| Task classifier | `classify.js` | domain/risk/complexity/urgency/capabilities (deterministic) |
| Capability/provider/agent registries | `registries.js` | typed interfaces; mock provider is the only enabled one |
| Policy-decision engine | `policy.js` | high-risk → blocked pending approval |
| Mock router | `route.js` | `RoutingDecision`; mock-only by construction |
| Mock workflow executor | `execute.js` | reuses the reviewed mock provider; refuses non-mock |
| Deterministic verifier | `verify.js` | gates completion and learning |
| Structured events + recorder | `events.js` | writes `task_events` + `hermes_workflow_steps` |
| Memory extractor (candidates) | `memory.js` | pending only; refuses unverified runs |
| Secret redaction layer | `redaction.js` | deep key- and pattern-based |
| Persistence | `store.js` + 6 `hermes_*` tables | redaction-on-write |
| Tests | `tests/hermes-orchestrator.test.js` | 7 tests, all passing |

## Intentionally deferred (later milestones)

- Real provider adapters (M2, dev-only, allowlisted, budgeted, no prod).
- DB-backed registries, scorecards, verified-outcome routing improvement (M3).
- **Memory promotion** (M3) — approval-gated; **no promotion path exists yet**.
- Memory retrieval service, memory-conflict handling (M3).
- Telegram/PWA/voice integration, dashboards, provider health/fallback (M4).
- Live approval persistence wiring for high-risk tasks (currently blocked, not queued).

## Guarantees in this milestone

- The existing `packages/hermes/hermes.js` task pipeline is unchanged.
- Only the credential-free mock provider can execute; real providers are registry-disabled.
- Memory candidates are always `status='pending'` and never promoted.
- Every persisted Hermes payload is redacted; no secret or env value is stored.
- Additive schema only; reversible by dropping the `hermes_*` tables and deleting the module.
