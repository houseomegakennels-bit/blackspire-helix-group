# Hermes Milestone 3C — Workspace Review Queue

Status: implemented in a stacked draft branch; not independently reviewed or merged.

## Purpose and boundary

The queue is a read-only operator view over existing pending memory candidates and their existing
root/re-review chains. It adds no queue table, refresh job, notification, mutation route, promotion
permission, or promotion behavior. A `recommend_promote` decision remains advice that authorizes
nothing. The queue imports no router, executor, provider, health, memory-retrieval, or scorecard
mutation surface.

## Service and HTTP contract

`listMemoryCandidateReviewQueue(principal, workspaceId, options)` accepts a limit from 1 through 50,
an optional canonical cursor, and `reviewState=all|unreviewed|reviewed`. The GET-only route is
`/api/hermes/workspaces/:workspaceId/memory-candidate-review-queue`.

The existing configured evaluation-admin binding is required. Reads reuse `evaluation.read`; they do
not require `evaluation.correct`. Binding failures return 403, absent/ungranted workspaces return an
indistinguishable 404, malformed requests return 400, rate limiting returns 429, and a corrupt selected
review chain fails the whole page with 409 rather than disappearing.

Authorization is decided before any workspace existence, candidate, count, review, chain, digest, or
eligibility work. Current authority is re-proved inside the transaction without a second audit row.
One page therefore emits one audited permission decision, never one per candidate.

## Pagination and integrity

Pagination is keyset-based on `(created_at,id)` with an exact non-unique index over
`(workspace_id,status,created_at,id)`. The opaque base64url cursor is canonical JSON bound to the
queue version, workspace, review-state filter, timestamp, and candidate id. Workspace scope remains
an independent SQL predicate; a cursor is navigation state, never authority. Pages fetch at most 51
rows and expose no total count.

Every selected candidate is revalidated. An intact review chain exposes only its effective head,
including decision, rationale, reviewer, chain version, and whether the mutable live candidate has
changed since that decision. Missing or non-intact outcome evidence leaves the candidate visible with
blocked eligibility. Root or successor corruption fails the page closed. Digests are verification
machinery and are not returned by this queue.

## Limitations

- Pagination is deterministic for unchanged rows but is not a durable cross-request snapshot.
- Verification is bounded but may read up to 50 chains of depth 64.
- Digests remain unkeyed corruption detection, not database-writer tamper resistance.
- Reviewer attribution remains outside re-review digest coverage.
- Global/NULL-workspace candidates remain excluded because workspace grants cannot authorize them.

## Rollback

See `HERMES_M3C_ROLLBACK.md`. Reverting this slice removes a read surface and ordinary index only. It
must never delete or rewrite candidate, review, re-review, evaluation, or authorization rows.
