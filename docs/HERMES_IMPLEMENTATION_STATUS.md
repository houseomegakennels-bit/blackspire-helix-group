# Hermes Intelligence Layer — Implementation Status

## Milestone 2 — Runtime & Provider Framework (MERGED via [PR #56](https://github.com/houseomegakennels-bit/blackspire-helix-group/pull/56))

Development-only real-provider runtime, additive on M1. Mock remains the default; real execution is
disabled by default and refused under the production profile. First real adapter: **Anthropic
Messages API (non-agentic Claude)** — chosen over the agentic Claude Code CLI as materially safer
(pure text I/O, no shell/agent surface), approved by the operator.

- **Implemented + tested:** runtime-profile gate, typed provider/capability registries, Anthropic dev adapter, deterministic fake provider, real/mock execution flow (timeout, cancellation, retry ceiling, concurrency limit, size limits, budget/cost ceiling, no silent real→mock fallback), scoped single-use approvals, provider health/cooldown, usage/cost recording (null-safe), read-only `/api/hermes/runtime` + `/hermes-runtime` PWA page. Real dispatch additionally requires the development feature flag, provider allowlist, registered/allowlisted workspace root, positive bounded task spend reservation, and a valid approval. 3 new additive tables (`hermes_provider_invocations`, `hermes_provider_health`, `hermes_approvals`).
- **Tested with fixtures only:** the real adapter is exercised via the fake provider; no paid call in the suite.
- **Awaiting live smoke test:** `scripts/hermes-dev-smoke.js` is prepared but disabled; a bounded development-only live call requires separate explicit operator opt-in and was not run for this merge.
- **Deferred to M3:** learned/multi-provider routing, scorecards, approval-gated memory promotion, cross-host limits, pricing→cost.
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
