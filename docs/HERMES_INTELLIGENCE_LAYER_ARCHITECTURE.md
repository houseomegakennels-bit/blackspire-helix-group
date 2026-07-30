# Hermes Intelligence Layer — Architecture

Status: **Milestones 1 and 2 merged; Milestone 3A in final validation.** This document is the Phase A
architecture for evolving Hermes into the central orchestration and learning layer for Jarvis. It
builds on the existing codebase; it does not introduce a disconnected subsystem.

## 1. What already exists (reused, not reinvented)

| Concern | Existing module | Reuse in Hermes |
| --- | --- | --- |
| Task pipeline | `packages/hermes/hermes.js` (`processTask`) | Left unchanged; the orchestrator is additive alongside it |
| Contract envelope | `packages/hermes/contract.js` | Capability-class denials, redaction, byte caps |
| Provider execution | `packages/providers/providers.js` | Provider adapter substrate (mock/manual/real) |
| Policy / approvals | `packages/policy`, `approvals` table | Policy + approval engines |
| Conversations / messages / tasks / ordered events | `packages/unified-input`, `task-engine`, `task_events` | Canonical intake + event stream (charter #1, #14) |
| Cost / usage | `provider_usage`, `provider_attempts` | Cost & usage tracker (charter #7) |
| Redaction | `packages/shared/util.js` `redact` | Secret redaction layer (charter #12) |
| Schema + migration | `migration-writer.js`, `schema-validation.js` | Additive migrations, fail-closed startup |

## 2. Component map (existing → Hermes role)

- **Orchestrator** — `packages/hermes-orchestrator/orchestrator.js` (`runHermesWorkflow`), the single service boundary.
- **Task normalizer** — `normalize.js` (validated `NormalizedTask`, reuses canonical ids).
- **Task classifier** — `classify.js` (domain/risk/complexity/urgency/capabilities; deterministic).
- **Capability / provider / agent registries** — `registries.js` (typed interfaces; provider registry wraps `providers.js`).
- **Policy engine** — `policy.js` (M1) → reuse `packages/policy` (later).
- **Approval engine** — `approvals` table + existing approval flow (wired in M3).
- **Workflow planner / executor** — `execute.js` (mock only in M1) → real adapters (M2+).
- **Verifier** — `verify.js` (deterministic pre-completion checks).
- **Event recorder** — `events.js` (writes `task_events` + `hermes_workflow_steps`).
- **Cost & usage tracker** — reuse `provider_usage` (+ `cost_cents` on runs).
- **Memory extractor** — `memory.js` (candidate only, pending).
- **Memory retrieval service** — deferred (M3), reads promoted memory (a future table).
- **Routing scorecard** — deferred (M3), `hermes_agent_metrics` (future).
- **Secret redaction layer** — `redaction.js` (deep, key- and pattern-based).
- **Retry / timeout controller** — reuse existing deadline + `MAX_RETRIES` (M1 mock is instant).
- **Human-in-the-loop checkpoints** — policy → approval (high-risk blocked pending approval in M1).
- **Kill switch** — reuse `system_flags.emergency_stop` (honored by the orchestrator).
- **Provider health / fallback** — deferred (M3).

## 3. Data model

Reused (not duplicated): `conversations`, `unified_inputs` (messages), `tasks`, `task_events`
(ordered events), `approvals`, `provider_usage`, `provider_attempts`, `audit_events`.

Added in Milestone 1 (all `hermes_*`, additive, redaction-on-write):

| Table | Purpose |
| --- | --- |
| `hermes_workflow_runs` | one orchestrated run per task attempt (status, outcome, provider, agent, cost) |
| `hermes_workflow_steps` | ordered, redacted per-step audit within a run |
| `hermes_routing_decisions` | classification + candidates + selected provider/agent + rationale |
| `hermes_policy_decisions` | action class, decision, requires-approval, reason |
| `hermes_verification_results` | verifier id, pass/fail, per-check detail |
| `hermes_memory_candidates` | **pending** lessons; never promoted in M1 |

Added in Milestone 3A: immutable outcome evaluations/components, additive correction chains,
explicit source-evidence events, and sanitized evaluator-failure records. Their complete canonical
provenance is factual input for later learning work but has no routing or memory side effect.

Milestone 3B adds `hermes_verified_scorecards` and `hermes_verified_scorecard_sources`: append-only
verified scorecard snapshots and their ordered source lineage, derived only from intact 3A evidence
and carrying no routing or memory side effect. These supersede the entity sketched in earlier drafts
of this document as `hermes_agent_metrics`.

Deferred entities (post-3B): `hermes_agents`, `hermes_providers`, `hermes_capabilities` (DB-backed
registries), `hermes_memories` (promoted long-term memory), `hermes_memory_conflicts`. **Raw audit (`audit_events`/`task_events`/`hermes_workflow_steps`) is
deliberately separate from promoted memory (charter #13).**

## 4. Controlled learning model

Learning = **structured event capture → deterministic outcome evaluation → verified lesson
extraction → (gated) promotion → retrieval/routing improvement.** Milestones 1 and 3A implement
capture, factual outcome evaluation, and pending candidate extraction only. Phase 3A's
`positive_eligible` label is evidence classification, not a scorecard update or routing input.

Learning explicitly is **not**: automatic model retraining; uncontrolled prompt mutation; blind
storage of all raw outputs as long-term memory; self-modifying production code; or bypassing review/
approval gates. Guards: candidates are extracted **only** from verified runs (`memory.js` refuses
unverified/failed runs — anti-poisoning); candidates are always `status='pending'`; there is **no
promotion code path** in M1 — promotion requires explicit policy/human approval added in M3.

## 5. Milestones

1. **Foundation + schemas, mock-only** (this PR): normalization, registries, classify, mock route,
   mock execute, deterministic verify, event recording, pending memory candidate, tests.
2. **One real adapter, development-only**: strict capability/domain allowlists, per-task budgets,
   redaction, dev profile only — **no production activation, no prod keys**.
3. **Verified learning foundations:** 3A immutable outcome provenance; 3B non-operative verified scorecards; then approval-gated memory candidate review/promotion.
4. **Safe provider/agent registry, identity, operator PWA, and Telegram transport.**
5. **Learned routing with explicit rollback, then production-readiness and Gate 4 review.**

## 6. Acceptance criteria & tests

- **M1 (done):** `tests/hermes-orchestrator.test.js` proves the slice *task → normalize → route →
  execute → verify → events → pending candidate*, plus: high-risk blocked pending approval, secret
  redaction of persisted columns, "candidates are only ever pending", kill-switch refusal, and unit
  tests of normalize/classify/route/redaction. Migration-safety and existing regressions stay green.
- **M2:** adapter allowlist/budget/redaction tests; a real call is attempted **only** under an
  explicit dev profile and is refused under the production profile.
- **M3:** scorecard math tests; promotion requires a recorded approval; retrieval improves routing on
  a fixture; memory-conflict handling.
- **M4:** Telegram/PWA event-parity tests; dashboard read-model tests; production-readiness review.

## 7. Security risks & controls

| Risk | Control (M1) |
| --- | --- |
| Prompt / command injection | Mock-only; no shell/network; capability-class denials retained |
| Secret leakage | Deep redaction of every persisted payload; no env values stored |
| Privilege escalation / unauthorized provider use | Routing restricted to `mock`; real providers registry-disabled; production-profile disabling untouched |
| Unsafe shell / malicious repo content | No shell execution; artifact paths verified relative/traversal-free |
| Untrusted tool outputs / false verification | Deterministic verifier gates completion; failed verification blocks learning |
| Memory poisoning | Candidates only from verified runs; never auto-promoted |
| Runaway cost / recursive loops | Budget + deadline guards; single-pass, no re-entrant execution |
| Cross-user data leakage | Workspace/actor scoping carried through every record |

## 7b. Milestone 2 — Runtime & Provider Framework (development-only)

Adds a gated real-provider runtime beside the mock default. New modules: `runtime-profile.js`
(fail-closed dev gate), extended `registries.js` (typed provider/capability definitions),
`adapters/` (`base`, `mock`, `fake-provider`, `anthropic-dev`, `index` resolver), `health.js`,
`approvals.js`, `concurrency.js`, `status.js`. New additive tables: `hermes_provider_invocations`,
`hermes_provider_health`, `hermes_approvals`.

First real adapter: **Anthropic Messages API (non-agentic Claude)** — pure text-in/JSON-out, no
shell/file/agentic surface, chosen over the agentic Claude Code CLI as materially safer.

Flow (development): task → normalize → classify → policy → capability resolution → provider selection
(mock default; real only when explicitly requested and gated) → approval check (medium-risk) →
budget/deadline → real|mock execute (timeout/cancel/retry/concurrency/size limits) → verify → events
→ usage/cost → pending memory candidate. **No silent real→mock fallback; production refuses all
Hermes-runtime execution.** Threat controls per §7 extend to: production-profile bypass (structural
refusal), unauthorized provider selection (allowlist + registry), approval replay/staleness
(single-use + expiry), runaway retries (retry ceiling), concurrency (in-process limiter), timeout
evasion (AbortController), cancellation (signal), cost bypass (per-provider + task ceiling),
health/cooldown, and credential exposure (env-only, header-only, boolean status). Full guide:
`HERMES_M2_RUNTIME_AND_PROVIDERS.md`.

## 8. Non-goals for Milestone 1

No real providers, no Telegram, no voice, no production activation, no changes to
`/etc/blackspire/command.env`, the immutable release, `current` symlink, nginx, TLS, or systemd.
