# Hermes Milestone 3C — Approval-Gated Memory-Candidate Review

Status: first vertical slice implemented on a draft PR, built on merged Milestone 3B
(`9dccdd95f5119195b192ee1f553b55d0eae3e48f`, reviewed head
`fd3ab87e4a8363699a11775301e50fb67d56fd44`).

## What this milestone is

A **review** is an append-only, workspace-isolated record of a human judgement about one Milestone 1
memory candidate. It is evidence about a candidate; it is not an instruction to anything.

**This milestone is review-only.** It promotes nothing, writes no memory, retrieves no memory into
any prompt or routing decision, and changes no routing, provider selection, provider health, task
execution, approval, or production behaviour. Nothing in `m3c-v1` reads a review.

## Why a review is a new row and never a status update

`hermes_memory_candidates` is a Milestone 1 table with **no immutability triggers**, and its `status`
and `promoted_at` columns *are* the promotion mechanism. Writing `status='reviewed'` there would
introduce the first `UPDATE` path against exactly those columns, and "review-only" would become a
code convention rather than a structural fact.

So review-only rests on three mechanical, testable facts rather than on discipline:

1. No code anywhere issues `UPDATE` or `DELETE` against `hermes_memory_candidates`. `store.js`
   exposes no writer for it, and a test asserts the absence by scanning the source.
2. `status` stays `'pending'` and `promoted_at` stays `NULL` for the whole milestone, pinned
   byte-for-byte by a table digest across successful, refused, and read operations.
3. Nothing reads `hermes_memory_candidate_reviews`. Like the 3A and 3B tables, it is inert evidence.
   A promoter would be its first consumer and requires its own reviewed milestone.

The decision vocabulary is deliberately advisory and contains **no `promote` value**:
`recommend_promote`, `reject`, `defer_needs_evidence`. A `CHECK` constraint refuses a
promotion-shaped value at the database layer, not merely in application code.

## Derivation and validation rules

1. A review is recorded only by an explicit service call. There is no HTTP mutation route, no
   background job, no startup or workflow-completion hook, no backfill, and no automatic refresh.
2. Scope comes from the stored candidate row and is **never** a caller argument, so no caller can
   widen scope or review into a workspace they were not granted.
3. A candidate is reviewable only when it is `pending`, unpromoted, `workspace`-scoped, has a
   canonical workspace id, a non-empty lesson, and a canonical timestamp.
4. The candidate's run must have an intact Milestone 3A evaluation at the canonical evaluation
   version, in the same workspace. An opinion about unverified work fails closed.
5. A failure is scoped to **that candidate only**. Unlike 3B aggregation, one bad candidate must
   never make its workspace's other candidates unreviewable; a regression pins this.
6. A rationale is required, non-empty, and at most 2000 characters, and is stored through
   `redactString`. A human judgement with no recorded reason is not evidence.
7. The reviewer is the server-resolved principal, never a caller-supplied field.
8. `m3c-v1` permits exactly **one terminal review per candidate**. Re-review and successor chains are
   deferred, so a second decision refuses rather than silently superseding a recorded judgement.
9. Replay of the same idempotency key with byte-identical derived content returns the stored review
   and writes nothing. The same key with different content is an integrity conflict, never an
   overwrite. Keys are scoped per workspace.

## Authorization

Reads reuse the canonical `evaluation.read` permission. Recording persists a permanent immutable row
and therefore additionally requires the write-capable `evaluation.correct`, exactly as 3B derivation
does: a read-only viewer grant must not append human judgements. **No new permission and no new
environment variable is introduced.**

Both audited decisions are taken **before** the transaction opens, so a denial survives the rollback
any later refusal triggers, and are re-proved inside the transaction with the non-auditing
`hasCurrentWorkspacePermission` so a grant revoked mid-operation refuses. One recording emits exactly
two audited decisions.

On the read path authorization is decided **before** the integrity check, so an unauthorized caller
causes no candidate read and no digest work and can measure nothing about a review they cannot read.

On the record path an absent candidate, a candidate whose workspace is NULL or malformed, and a
candidate in a workspace the caller holds no grant in all refuse with a **single** message
(`memory candidate review is not authorized`). Differentiating them would let a principal granted in
any one workspace supply well-formed candidate ids and learn which candidates exist in every other
workspace. Only a caller already authorized in the candidate's own workspace reaches the
differentiated subject diagnostics. One residual asymmetry is accepted and not closed: a denial is
audited against the candidate's workspace while an absent candidate names no workspace to audit
against, so `auth_decisions` distinguishes the two cases. That channel is visible only to a reader of
the audit log, never to the calling principal.

The single HTTP surface is `GET /api/hermes/memory-candidate-reviews/:id`, byte-parallel to the 3B
scorecard route: the same configured evaluation-admin binding, `403` when that binding fails, and an
indistinguishable `404` for an unknown id, a cross-workspace id, and a non-intact review.

## Digests

Two, mirroring 3B. `content_digest` covers what was decided; `lineage_digest` covers what it was
decided on, including the pinned candidate and the 3A evaluation lineage. Neither covers the row id,
the reviewer, or `created_at`, which are assigned at insert time — hashing them would make an
idempotent replay depend on write order.

`candidate_digest` pins the candidate row as it read at decision time over an explicit column list.
Because the candidate table has no immutability triggers, that pin is the only thing that makes a
stored review verifiable: it turns "reviewed candidate X" into "reviewed candidate X *as it then
was*". A candidate mutated afterwards leaves the review readable and still describing what was
actually reviewed.

## Acceptance gates

Every bullet below maps to a named test in `tests/hermes-m3c-memory-review.test.js`.

- A review records the decision, rationale, reviewer, pinned candidate, and 3A lineage.
- Recommending promotion records an opinion and promotes nothing; the candidate row is byte-identical
  afterwards and the database refuses a `promote` decision value.
- An unreviewed candidate reads as an explicit absence, never a defaulted decision.
- Recording requires `evaluation.correct`; reading requires only `evaluation.read`; a refused
  recording leaves a durable audited denial and writes no review.
- Cross-workspace recording refuses, and a cross-workspace read is indistinguishable from an unknown
  id.
- Out-of-enum decisions, empty and over-long rationales, malformed ids and keys, missing candidates,
  non-pending, promoted, global-scope, null-workspace, and empty-lesson candidates all fail closed
  and write nothing.
- A candidate whose run has no intact outcome evidence is unreviewable, **and its neighbours remain
  reviewable**.
- Replay returns the stored review; a conflicting replay refuses; a second decision refuses;
  idempotency keys are workspace-scoped.
- The review table rejects `UPDATE` and `DELETE`.
- A review whose stored content no longer reproduces its digests is unreadable, including a silently
  upgraded decision.
- A candidate mutated after review keeps the review readable and pinned to what was decided.
- Recording, reading, and refusing all leave every candidate, routing, policy, provider, approval,
  workflow, outcome, scorecard, and task table and the whole schema byte-identical.
- An identical task routes identically before and after a review exists.
- The module imports no router, executor, provider, health, memory, or scorecard surface, reads no
  environment flag, and no update or delete path exists for candidates or reviews.
- A review is unaffected by whether the workspace has verified scorecards.
- The workspace-scoped pending reader never returns another workspace and orders totally.
- Authorization precedes integrity work on the read path.
- The record path refuses a real cross-workspace candidate and an absent one identically, so it
  discloses no candidate existence across workspaces.

## Status and limitations

Implemented and validated at the exact head. Known limitations, all deliberate:

- **The candidate table is mutable and has no immutability triggers.** This is weaker than the 3A and
  3B position and is inherited from Milestone 1, not introduced here. A candidate can be edited or
  physically deleted by anything with database write access, with no trigger to drop first. The
  `candidate_digest` pin is the mitigation: it makes such a change detectable *relative to a recorded
  review*, but it cannot prevent it and cannot detect a change to a candidate that was never
  reviewed.
- **Digest verification is corruption detection, not tamper resistance.** All three digests are
  unkeyed SHA-256 over fully persisted public inputs, so an actor who can already write these tables
  can recompute them to match an edit. No later milestone may treat this as an integrity control
  against a database-write adversary.
- **One terminal review per candidate; there is no re-review.** A reviewer who decides wrongly cannot
  correct the record in `m3c-v1`. A successor chain, following the 3A correction and 3B successor
  patterns, is the natural next increment and was excluded to keep this slice bounded.
- **A global-scope candidate is permanently unreviewable.** A workspace grant cannot authorize a
  decision whose blast radius is global. `memory.js` only ever writes `'workspace'`, so this is
  currently unreachable, but who may review a global lesson is an open policy question that must be
  answered before global candidates exist.
- **A candidate with a NULL workspace is permanently unreviewable.** `insertMemoryCandidate` writes
  `candidate.workspaceId || null`, and a NULL workspace can satisfy no grant. Failing closed is the
  safe outcome; whether to backfill such rows is deferred.
- **`getPendingMemoryCandidates` remains unscoped.** The Milestone 1 helper returns every workspace's
  pending candidates and is now marked test-only; `getPendingMemoryCandidatesForWorkspace` is the
  workspace-isolated reader this milestone adds and uses. The unscoped helper is left in place
  because deleting it would change a merged test, and it backs no authorized surface. **It must never
  back one.**
- **There is no review queue or listing route.** A list endpoint is the highest cross-workspace
  disclosure surface in this design and deserves its own increment.
- **Registry drift breaks revalidation**, inherited from 3A: revalidation re-runs registry routing
  against live registries, so editing a registry entry makes older evidence unreadable and its
  candidates unreviewable.
- Milestone 3A's `readOutcomeEvaluation` still validates before authorizing, the ordering corrected in
  3B and again here, so the 3A read path remains inconsistent with the other two. Tracked as a
  follow-up, not addressed by this milestone.

Nothing here activates memory promotion, memory retrieval, learned routing, scorecard-informed
routing, provider execution, deployment, production, or Gate 4.

## Deferred after 3C

Promotion of any kind and any writer for `hermes_memory_candidates`; a promoted-memory table and
conflict model; any retrieval or prompt-assembly surface; a review queue or listing endpoint; any
POST or mutating HTTP route, and the open decision of whether such a route should require a
permission beyond `evaluation.correct`; re-review and successor chains; global-scope review policy;
backfill of existing pending candidates; bulk review; notifications; and operator UI. Scorecard-
informed learned routing, live providers, production deployment, and Gate 4 remain separate
dependency-ordered milestones.
