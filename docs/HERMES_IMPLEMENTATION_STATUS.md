# Hermes Intelligence Layer — Implementation Status

## Milestone 3C, second slice — Re-review and successor chains (draft PR, in progress)

- **Implemented:** additive, idempotent, append-only `hermes_memory_candidate_rereviews` with database-enforced immutability triggers; a re-review modelled as an explicit successor that links to the record it supersedes and never overwrites it; database-enforced chain shape (`UNIQUE(root_review_id,chain_version)` against forks at every depth including the first successor, `UNIQUE(supersedes_rereview_id)` against forks off a successor, a depth/parent CHECK against ambiguous ancestry, and self-link CHECKs); a required `supersedes` that must name the chain's current head, so a stale or conflicting predecessor refuses and two concurrent re-reviewers resolve to one winner and one explicit refusal rather than a fork; ancestry verified all the way to the root rather than one hop, because a predecessor's own digests do not cover its `supersedes_rereview_id`; a predecessor content/lineage digest pin; deterministic `chain_version` ordering and replay; workspace-scoped idempotent replay with integrity-conflict detection; a bounded chain depth enforced on both write and read; and a read-only service plus one GET route reusing canonical `evaluation.read`.
- **No inherited authority:** a successor inherits no approval, correctness, scorecard result, authorization, or promotion eligibility from its predecessor. Decision and rationale are supplied fresh by the caller, the write-capable `evaluation.correct` is required per call and re-proved in-transaction against current grants, and the candidate is revalidated from scratch against live Milestone 3A evidence. Carried context is an explicit identity-only allowlist, copied safely and provenance-tracked, with a denied-key guard re-proved at every nesting depth on both write and read.
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
