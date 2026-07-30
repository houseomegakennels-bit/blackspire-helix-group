# Hermes Intelligence Layer — Implementation Status

## Milestone 3B — Verified scorecards (PR #60, open draft)

- **Implemented:** additive, idempotent, append-only `hermes_verified_scorecards` and `hermes_verified_scorecard_sources` with database-enforced immutability triggers, a UNIQUE snapshot identity, a linear successor chain, and an explicit gap-free lineage `seq`; deterministic `m3b-v1` derivation from intact Milestone 3A evaluations only, selected by the canonical `(created_at, id)` cutoff tuple and revalidated per source through the single exported definition of "intact"; exact integer metrics with unknown as a first-class count and ratios stored as integer numerator/denominator pairs; sample-size-only confidence bands (`insufficient` under 5, `limited` 5–19, `established` 20 or more); a lineage digest over version, scope, cutoff, ordered sources, correction heads, ordered source-event ids, and every persisted metric; idempotent replay that distinguishes legitimately appended Milestone 3A source evidence (resolved by deriving a later cutoff) from a genuine integrity conflict; a cutoff-monotonicity guard so a successor can never regress a scope to an earlier cutoff; structural verification of `scope_version` and `supersedes_scorecard_id` against the real predecessor on every read, since those fields are assigned at insert time and cannot be hashed without breaking replay; fail-closed handling of mixed versions, corrected, cross-workspace, malformed, and contradictory evidence, out-of-enum classification facets, and non-four-digit-year cutoffs.
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
