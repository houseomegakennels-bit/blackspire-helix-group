# Hermes Milestone 3C — Re-Review and Successor Chains

Second slice of Milestone 3C, on top of the merged and anchored first slice
(`bf9072c5ebc1f195020e7c1709610c741cf8be43`, reviewed head
`1b589807af5d8179ad5b63e13648645dc2741d57`).

The first slice recorded exactly one terminal review per memory candidate, and listed "one terminal
review per candidate with no re-review or successor chain" as an accepted limitation. This slice
closes that limitation and nothing else.

## What this slice is

A re-review is a **new append-only row** in `hermes_memory_candidate_rereviews` that **links to** the
record it supersedes. The chain root is the one `hermes_memory_candidate_reviews` row for the
candidate; successors are `chain_version` 1..n. Historical records are never overwritten: the root
review and every earlier successor stay byte-identical, protected by their own immutability triggers,
and the whole chain replays in `chain_version` order.

Recording a successor is an internal service call, `recordMemoryCandidateRereview`. There is no HTTP
route for it, no background job, no startup or workflow-completion hook, no historical backfill, and
no automatic refresh. The single surface is `GET /api/hermes/memory-candidate-rereviews/:id`.

## Why a separate table rather than an in-table `supersedes_*` column

This follows the Milestone 3A correction-chain shape rather than the 3B in-table shape. The reason is
structural, not stylistic: the merged review table declares an inline `UNIQUE(candidate_id)`, and
SQLite can only drop an inline constraint by **rebuilding the table** — which means copying and
re-writing historical immutable rows, exactly what a successor chain exists to avoid. Keeping the
root byte-untouched is the whole point of the slice.

## Invariants

Chain shape is enforced by the database, not by convention:

| Invariant | Enforcement |
| --- | --- |
| No fork at any depth, including the first successor | `UNIQUE(root_review_id,chain_version)` plus `idx_hermes_memory_rereviews_chain_unique` |
| No two successors of one successor | `UNIQUE(supersedes_rereview_id)` plus `idx_hermes_memory_rereviews_parent_unique`. SQLite permits many NULLs, which is why the pair index above carries the depth-1 case |
| No ambiguous ancestry | `CHECK((chain_version=1 AND supersedes_rereview_id IS NULL) OR (chain_version>1 AND supersedes_rereview_id IS NOT NULL))` — depth 1 supersedes the root and names no successor; every deeper row must name one |
| No self-link | `CHECK(id<>root_review_id)`, `CHECK(supersedes_rereview_id IS NULL OR supersedes_rereview_id<>id)` |
| No cycle | Unreachable given a strictly increasing `chain_version` over an append-only table with no update or delete helper. A cycle forged by a database-write actor is refused on read and refuses further appends |
| Immutable history | `BEFORE UPDATE` and `BEFORE DELETE` triggers on the new table, matching the review table |
| Deterministic ordering and replay | `ORDER BY chain_version`, which is unique per root and therefore a total order — unlike `created_at`, which is millisecond-resolution and ties |

Enforced by the service:

- **`supersedes` is required and must name the chain's CURRENT head** — the root review id when no
  successor exists yet, otherwise the latest successor id. Anything else (the root after a successor
  exists, a superseded ancestor, a successor of another chain) is a stale or conflicting predecessor
  and refuses. This is what turns two concurrent re-reviewers of the same head into one winner and
  one explicit refusal rather than a fork; the unique index enforces the same thing independently.
- **Ancestry is verified all the way to the root, not one hop.** A predecessor's own digests do not
  cover its `supersedes_rereview_id`, so an ancestor could be re-pointed into a cycle or onto a
  foreign chain while every descendant's pin still matched. Recursion terminates because each step
  requires `chain_version` to decrease by exactly one, and is bounded by the depth bound below.
- **Workspace and tenant isolation across every chain operation.** A successor's workspace and
  candidate are bound to the root's on read; the predecessor head's workspace and candidate are
  re-verified on append; and the live candidate must belong to the same workspace as the chain.
  `workspace_id` is deliberately **not** covered by either digest — it is structural, not content —
  so these explicit bindings, not the digests, are what catch a forged workspace.
- **A successor requires a new independent decision.** `decision` and `rationale` are supplied fresh
  by the caller and are never copied from the predecessor. An unexplained reversal of a recorded
  human judgement is worse evidence than the judgement it replaces.
- **A successor inherits no authority.** Not approval, correctness, scorecard results, authorization,
  or promotion eligibility. The caller must hold the write-capable `evaluation.correct` at the time
  of the call, re-proved inside the transaction against current grants, and the candidate is
  revalidated from scratch against live Milestone 3A evidence. A candidate that has since been
  promoted, altered, or lost its intact evaluation is no longer re-reviewable even though its
  predecessor was recorded when it was.
- **Inherited context is an explicit allowlist, copied safely and provenance-tracked.**
  `INHERITED_CONTEXT_KEYS` is subject identity only: `candidateId`, `runId`, `taskId`,
  `candidateKind`, `candidateScope`. Every value is required to equal the freshly revalidated
  subject, so a chain that disagrees with the live candidate refuses. The stored block records
  exactly what was copied and from where. `DENIED_INHERITANCE_KEYS` re-proves at every nesting depth,
  on both write and read, that no judgement- or authority-bearing key reached the carried context, so
  widening the allowlist cannot silently smuggle one in.
- **Chains are bounded** at `MAX_REREVIEW_CHAIN_DEPTH` (64) on both write and read. Verifying
  ancestry is super-linear, so an unbounded chain would let an authorized principal turn a cheap
  append into arbitrarily expensive reads for its whole workspace, and would overflow the
  verification recursion before any refusal could fire. Milestone 3B's accepted limitation
  ("derivation is unbounded and must be bounded before any derivation API ships") is not repeated
  here. The read-side half also makes the recursion provably terminating whatever is in the table.

## Review-only

The decision vocabulary is unchanged — `recommend_promote`, `reject`, `defer_needs_evidence` — and
contains no `promote` value, refused by a database CHECK rather than only in application code. No
writer of any kind exists for `hermes_memory_candidates`, so `status` stays `pending` and
`promoted_at` stays NULL. A successor of a `recommend_promote` predecessor promotes nothing and
grants no eligibility. Tests pin all of this by byte-identical table digest and by source scan.

## Threat model

The adversary this slice defends against is a caller holding a legitimate grant in **some** workspace,
plus, for the integrity checks, an actor who can write the database directly.

- A principal granted in one workspace cannot probe which reviews or candidates exist in another: an
  absent root, an unusable workspace, and an ungranted workspace all refuse with one message, and the
  read path returns `null` for absent, cross-workspace, and non-intact alike. The residual asymmetry
  is the audit log — a denial is audited against the object's workspace while an absent object names
  no workspace — visible only to a reader of `auth_decisions`, not to the caller. This is inherited
  unchanged from the first slice.
- A read-only viewer grant cannot append a successor.
- A grant revoked between the audited authorization decision and the write refuses, because the
  decision is re-proved inside the transaction. The audited denial itself is decided **before** the
  transaction opens, so it survives the rollback the refusal triggers.
- The digests are **unkeyed SHA-256 over public inputs**: corruption detection, not tamper resistance
  against an actor who can already write these tables. That actor is nonetheless constrained by the
  database CHECKs, the unique indexes, and the immutability triggers, and by the structural checks
  that are validated against the real root rather than against the row's own self-consistent digest.

## Acceptance gates

Focused suite `tests/hermes-m3c-rereview-successor.test.js`, 35 tests: valid successor and chain
creation; the read surface; allowlisted provenance-tracked inheritance and the absence of inherited
authority; self-links; cycles written around the service; forks refused by the service and
independently by the database; ambiguous depth-one ancestry; chain gaps; broken predecessor pins; a
corrupted root; cross-workspace append and read; workspace and candidate drift reached from an
authorized caller; foreign-chain linking; the `evaluation.correct` requirement, grant revocation, and
durable audited denial; caller-supplied reviewer attribution; stale ancestors; idempotent replay and
conflicting reuse of one key; two re-reviewers racing the same head; a candidate that stopped being
pending or was deleted; the depth bound on write and on read; database-enforced immutability of both
review tables; and byte-identical historical records across a whole appended chain.

## Status and limitations

Accepted, not resolved:

- Everything the first slice accepted still applies, including the mutable candidate table, the
  unkeyed digests, the `auth_decisions` asymmetry, the pre-redaction rationale bound, and the fact
  that column-name-only startup schema validation does not cover CHECK constraints.
- The read-side depth bound is defence in depth that no forgery can reach without also recomputing
  the row's digests, so it is not independently pinned by a test. It is retained because the
  threat model explicitly grants the adversary database writes.
- Several single-line guards are structurally redundant with a second independent check that catches
  the same forgery. Mutation testing confirms the invariants are pinned collectively — removing a
  whole layer fails the suite — but individual redundant lines are equivalent mutants. This matches
  the defence-in-depth pattern already accepted in Milestone 3B.
- There is still no review queue, no listing route, and no promotion.
- `getPendingMemoryCandidatesForWorkspace` still has no production caller.

## Deferred after this slice

The workspace-scoped review queue, then promotion. Promotion must not inherit `evaluation.correct` as
its authority without an explicit decision, and must not be automatic. Nothing in this slice
activates Gate 4, production routing, live providers, memory retrieval, historical backfill, or
production database provisioning.
