# Hermes Milestone 3A — Verified Outcome Scoring and Immutable Provenance

Phase 3A records append-only, redacted factual evaluations of newly completed Hermes workflow runs. It does not promote memory, retrieve memory, create scorecards, alter routing, backfill history, or run a live provider.

An internal evaluator runs only after a terminal workflow has ordered Hermes steps. It stores one row per `(run_id, evaluation_version)`, links routing/policy/verification/invocation evidence where present, and records a SHA-256 digest of the redacted evidence packet. Duplicate creation, incomplete runs, unordered steps, and nonterminal runs fail closed.

`m3a-v1` components are transparent: completion, deterministic verification, confidence class, retry count, duration, timeout, cancellation, known provider cost, and explicit unknown user-acceptance, rollback, and stability signals. Silence is never stability. Only a completed verified run is `positive_eligible`; blocked runs are `ineligible_blocked`; other terminal outcomes are factual negative evidence. These labels do not affect routing.

The project boundary is currently identical to the workspace boundary because the canonical task model has no separate project identifier. Cross-workspace evaluation access is not introduced.

## Authorization and read surface

PR #58's merged canonical authorization foundation is the only authority for Phase 3A evaluation reads. A request cannot select a principal, role, permission, workspace, or authentication method. The read endpoint accepts a single evaluation ID, derives its workspace from the stored record, resolves a server-configured canonical **admin bearer** principal, and requires that principal's active `evaluation.read` grant. Sessions are deliberately not mapped to principals, service principals cannot use the bearer path, and a missing, guessed, malformed, or cross-workspace ID returns the same unavailable result. The PWA's optional `?evaluation=<id>` view renders only that sanitized summary.

The response intentionally omits prompt text, classification JSON, provider payloads, components, credential references, hidden reasoning, and raw evidence. Authorization decisions are audited by the canonical service; an audit-write failure fails closed. There is no unscoped evaluation listing endpoint.

## Additive correction and evidence policy

Evaluations never change. Corrections are append-only records tied to one existing evaluation and therefore its immutable workflow and workspace. Each correction has a required reason and explicit source evidence; it must supersede the sole current correction head. The unique parent link plus service checks reject duplicate versions, branching, cycles, absent parents, and cross-run or cross-workspace links. `evaluation.correct` is required. Read-only history exposes correction metadata but never the actor identifier or raw evidence. Phase 3A uses a **current-authority** read model: subordinate evidence remains readable only while its persisted canonical admin/service actor is active, lifecycle-valid, has a valid workspace grant, and currently retains `evaluation.correct`; revocation, expiry, disablement, grant loss, or permission loss fails the related evaluation read closed. It does not infer or preserve an event-time human identity snapshot.

Source evidence is also append-only. Allowed event types are `accepted`, `rejected`, `partially_accepted`, `rollback`, `follow_up_verification`, `stability_confirmed`, and `regression_linked`. Every event requires a trusted authorized actor, an existing evaluation, explicit evidence, and a bounded unique idempotency key; replay or duplicate keys fail. Silence remains unknown. These events do not change routing, scorecards, task execution, or memory.

## Failure observability and operations

The terminal evaluator records a sanitized `open` evaluation-failure record when it cannot create an evaluation. It contains only the run/workspace linkage, bounded category, remediation state, and generic detail—never the caught error payload. It creates no retry loop. A future operator-owned retry must be explicit, bounded, and idempotent.

Migrations are additive and idempotent. Rollback is code rollback: existing Phase 3A tables remain inert immutable evidence and must not be edited or deleted. Development/test fixtures use disposable SQLite databases only. The authorization provisioning CLI is development/test-only, refuses production and shared paths, and never auto-runs at startup.

## Status and limitations

Phase 3A uses the merged authorization foundation, but it does **not** protect any other HTTP route, create human identities, provision real principals or grants, run a live provider, perform historical backfill, update scorecards, alter routing, or promote/retrieve memory. Phase 3B—including learning/routing behavior—is deferred. PR #57 remains draft until independent review; production is disabled and Gate 4 remains unauthorized.
