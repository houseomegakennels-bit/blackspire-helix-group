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

## Deferred after 3B

Approval-gated memory-candidate review/promotion, scorecard-informed learned routing, rollback of
learned routing, broader provider/agent registry work, verified human identity, operator PWA,
Telegram/voice integration, live providers, production deployment, and Gate 4 remain separate
dependency-ordered milestones.
