# Hermes Milestone 3A — Verified Outcome Scoring and Immutable Provenance

Phase 3A records append-only, redacted factual evaluations of newly completed Hermes workflow runs. It does not promote memory, retrieve memory, create scorecards, alter routing, backfill history, or run a live provider.

An internal evaluator runs only after a terminal workflow has ordered Hermes steps. It stores one row per `(run_id, evaluation_version)`, links routing/policy/verification/invocation evidence where present, and records a SHA-256 digest of the redacted evidence packet. Duplicate creation, incomplete runs, unordered steps, and nonterminal runs fail closed.

`m3a-v1` components are transparent: completion, deterministic verification, confidence class, retry count, duration, timeout, cancellation, known provider cost, and explicit unknown user-acceptance, rollback, and stability signals. Silence is never stability. Only a completed verified run is `positive_eligible`; blocked runs are `ineligible_blocked`; other terminal outcomes are factual negative evidence. These labels do not affect routing.

The project boundary is currently identical to the workspace boundary because the canonical task model has no separate project identifier. Cross-workspace evaluation access is not introduced. Records are immutable; a future correction must use a new evaluation version, not update a fact.

Rollback: revert Phase 3A code. The two additive tables may remain inert; no existing workflow records are modified.
