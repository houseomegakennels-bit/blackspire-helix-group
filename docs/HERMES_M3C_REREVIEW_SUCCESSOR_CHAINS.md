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

The resemblance to Milestone 3A is **structural only** — a separate append-only table linked to the
record it supersedes. It is not an ordering resemblance. 3C orders by `chain_version` alone and
attaches no meaning whatsoever to `created_at`; the 3B scorecard chain, by contrast, selects by a
`(created_at, id)` cutoff tuple. These milestones do **not** enforce the same `created_at` ordering
shape and must not be described as if they do. See
[`created_at` carries no ordering guarantee](#created_at-carries-no-ordering-guarantee).

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
  one explicit refusal rather than a fork. `UNIQUE(root_review_id,chain_version)` backs this up only
  for the race it names: a concurrent append that slips past the check still cannot produce a second
  sibling. It is not a general backstop for the head rule — `chain_version` is derived from the actual
  head rather than from `supersedes`, so with the head rule removed an append violates no unique index
  and instead silently re-parents. The head rule is the only guard on which predecessor is named.
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
- **Inherited context is an explicit allowlist, enforced positively on write AND on read.**
  `INHERITED_CONTEXT_KEYS` is subject identity only: `candidateId`, `runId`, `taskId`,
  `candidateKind`, `candidateScope`.

  On **write**, each value is copied from the predecessor and required to equal the freshly
  revalidated subject, so a chain that disagrees with the live candidate refuses.

  On **read**, `inheritedContextIntact` re-derives the block the module would have written for that
  row and requires the stored block to match it exactly: the four top-level keys and no others, the
  allowlist itself as the declared key list, exactly the allowlisted value keys, every value equal to
  the row's own identity column, and provenance equal to the predecessor pin the row already carries.
  This is a **positive allowlist, not a denylist**, and the distinction is load-bearing: the digests
  are unkeyed SHA-256 over public inputs, so a database-write actor can rewrite `inherited_context`
  and recompute the row's digests to match. A denylist only rejects the names it enumerates, and the
  forger picks the names — so anything unlisted would ride through to the API response, including a
  `candidateId` contradicting the row's own candidate. `DENIED_INHERITANCE_KEYS` is retained behind
  the allowlist, but it is **not** load-bearing on the read path either: because the allowlist pins
  every key name and requires every leaf to strict-equal a scalar column, no blob that reaches the
  denylist can carry a denied key. Deleting the read-side call does not change behaviour, and it is
  reported as a **declared equivalent mutant** rather than counted as killed — see
  [Mutation testing](#mutation-testing). It is kept only as a standing tripwire should the allowlist
  ever be widened to admit a non-scalar or free-form value.

  On the write path the denylist call is **unreachable**, and is documented as such rather than
  claimed as an enforced runtime invariant or as defence in depth: `inheritedContext` assembles its
  block entirely from frozen literals, so no caller-controlled key name can reach it and the check
  cannot fail for any input. A guard no input can trip defends nothing, and nothing here rests on
  it. The condition it was previously described as enforcing — a future widening of
  `INHERITED_CONTEXT_KEYS` into a denied name, or drift between that list and the column map — is a
  static property of the module, so it is decided once at load by `inheritanceAllowlistDisjoint()`,
  where it is actually decidable, and that predicate is exercised directly with a deliberately
  widened allowlist.
- **Chains are bounded** at `MAX_REREVIEW_CHAIN_DEPTH` (64) on both write and read. Verifying
  ancestry is super-linear, so an unbounded chain would let an authorized principal turn a cheap
  append into arbitrarily expensive reads for its whole workspace, and would overflow the
  verification recursion before any refusal could fire. Milestone 3B's accepted limitation
  ("derivation is unbounded and must be bounded before any derivation API ships") is not repeated
  here. The read-side half also makes the recursion provably terminating whatever is in the table.

  On the write path the bound is decided from the stored head's own `chain_version` **before any
  ancestry is verified**. Ordering matters and is pinned by a test: `rereviewPredecessor` walks the
  entire chain to the root, so checking depth after it would run a full-depth verification pass on a
  chain that is refused on depth regardless — the exact cost the bound exists to prevent. It is
  deliberately not re-asserted against the constructed predecessor afterwards, because that
  predecessor derives `chainVersion` from the same row and no input could trip a second check.
- **Replay and read agree on validity.** The idempotency replay path runs the same full
  `storedRereviewIntact` check as the read path. Re-deriving a row's digests only proves it is
  self-consistent — every input comes from the row's own columns — so a forged row with a foreign
  `candidate_id`, a broken predecessor pin, or invalid ancestry would otherwise be handed back as a
  successful replay while the read surface refused the very same row.

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

Focused suite `tests/hermes-m3c-rereview-successor.test.js`, 58 tests: valid successor and chain
creation; the read surface; allowlisted provenance-tracked inheritance and the absence of inherited
authority; self-links; cycles written around the service; forks refused by the service and
independently by the database; ambiguous depth-one ancestry; chain gaps; broken predecessor pins; a
corrupted root; cross-workspace append and read; workspace and candidate drift reached from an
authorized caller; foreign-chain linking; the `evaluation.correct` requirement, grant revocation, and
durable audited denial; caller-supplied reviewer attribution; stale ancestors; idempotent replay and
conflicting reuse of one key; two re-reviewers racing the same head; a candidate that stopped being
pending or was deleted; the depth bound on write and on read; database-enforced immutability of both
review tables; and byte-identical historical records across a whole appended chain.

Added after independent exact-head review found three defects (see "Corrections from review" below):
forged inherited-context blobs with the digests **resealed** — smuggled keys, undenied key names,
values contradicting the row's own identity columns, each provenance field forged individually, and
extra or missing top-level keys; replay refusing a stored row with a foreign candidate identity or a
broken predecessor pin, while a genuinely intact replay still returns unchanged; the depth bound
proven to be decided before any ancestry walk; a correctly linked, correctly pinned, digest-resealed
row at depth 65 that **only** the read-side bound refuses; and `inheritanceAllowlistDisjoint()`
exercised with a deliberately widened allowlist.

Added in the third pass, after a second round of exact-head review: a **root review** altered and
resealed after the fact, so it reads as intact on its own columns and only the descendant's pin
detects it; the same at depth 2 for an intermediate successor; a root altered only in a
**lineage-covered** field (`evaluation_id`), proving both halves of the pin are compared rather than
only the content half; a cross-root idempotency-key collision asserting the accurate error
classification; and a `created_at` test pinning that timestamps carry no ordering guarantee.

Added in the fourth pass, closing an undeclared surviving mutant: a successor sitting at the **wrong
depth relative to the ancestor it names**. The forgery names a real, fully intact ancestor, pins that
ancestor's genuine digests, carries correct provenance, and reseals its own packets, so every other
control passes — all rows are present so there is no gap to detect, no UNIQUE index is violated
because the skipped `chain_version` is free and the ancestor is superseded exactly once, and no
immutability trigger fires because the forgery is a plain INSERT. Only the predecessor/child
`chain_version` relationship in `storedRereviewIntact` refuses it, and the test proves **both** the
normal read and the idempotent replay reject it. The lineage-only and depth-2 pin tests were extended
in the same pass to assert the replay refusal as well as the read refusal, so their descriptions match
their true coverage.

Added in the fifth pass, after two independent exact-head reviews: three tests that tamper a stored
successor **without resealing** — a rewritten `rationale` with the digests left stale, and each digest
column corrupted alone while the other still matches exactly, which isolates the two halves that a
single tampered field cannot (it moves both at once). All three assert normal read refusal **and**
idempotent replay refusal with the `non-intact stored decision` classification. Alongside them, a
non-canonical `created_at` (hashed into neither packet, so no digest stands behind it) and a replay
against a different predecessor, which must be an identity conflict rather than a successful replay.

## Mutation testing

Reproducible from this branch: `node scripts/mutation-test-m3c-rereview.js`. It runs an unmutated
baseline first, requires every mutation pattern to occur **exactly once** in its target file (a
pattern matching zero or many places is a hard harness error, not a survivor), and restores the tree
after each mutant and on signal.

Current result: **22 killed, 2 declared equivalent, 0 surviving, 0 misdeclared.**

**What "0 surviving" does and does not mean.** It means every non-equivalent mutant *in the committed
list* was killed on this run. It is **not** a claim that no guard in the module can be deleted with
the suite green — two independent exact-head reviewers demonstrated by execution that several can,
and the fifth pass closed the load-bearing ones they identified rather than restating the number.
Guards that remain removable are ones whose states are independently rejected by a database CHECK or
by a tautology in how the row is fetched; they are not claimed here as enforced runtime invariants.
No claim of "fully pinned" is made about this module.

The mutant set deliberately covers pre-existing guards as well as recently repaired ones: the head
rule, the full-ancestry recursion, both halves of the predecessor digest pin, the read and write depth
bounds, and a true **reordering** mutant that moves the depth bound back after the ancestry walk —
distinct from the mutant that merely removes it. An earlier version of this harness conflated those
two and its label overclaimed; both now exist separately.

Five mutants were added in the fifth pass, closing the gap both exact-head reviewers reported.
Three cover `storedRereviewIntact`'s own content/lineage digest comparison — the whole comparison and
each half separately — which is the only guard covering `decision`, `rationale`, `candidate_digest`,
`candidate_status_at_review` and the evaluation fields. It had been unpinned because **every forgery
helper in the suite reseals the digests**, which is exactly what lets those tests reach the structural
checks, and so the simplest attack of all — change a column and leave the digests alone — was never
performed. The other two cover `canonicalTimestamp(created_at)`, the only guard on a column hashed
into neither packet, and the replay path's predecessor comparison.

One mutant was added in the fourth pass and is the one the earlier set missed — `read path: stop
requiring the predecessor to sit exactly one chain version below the child`: the predecessor/child
`chain_version` relationship. It is distinct from both halves of the digest pin,
which compare the ancestor's *digests* rather than its *depth*, and it survived every earlier harness
run because no test constructed a row that named a genuinely intact ancestor at the wrong depth. It is
now killed by a dedicated regression that proves both the normal read and the idempotent replay reject
the malformed chain.

### Declared equivalent mutants

Two guards can be deleted without changing observable behaviour. They are reported separately, never
folded into the killed count, and the harness treats a *killed* "equivalent" mutant as a hard error,
since that would prove the declaration wrong.

| Guard | Why deletion changes nothing | Same states independently rejected by |
| --- | --- | --- |
| Read-path `deniedInheritanceAbsent` | `inheritedContextIntact` runs first and pins every key name and every leaf, and each leaf must strict-equal a scalar column, so no blob reaching the denylist can carry a denied key at any depth | the smuggled-keys, undenied-names, and extra/missing-top-level-key tests |
| Write-path `rereviewChainValid` (**conditional — see below**) | every remaining conjunct is re-derived by `storedRereviewIntact` recursing head-to-root, which `rereviewPredecessor` already invokes; `UNIQUE(root_review_id,chain_version)` makes the row set for a root exactly the head ancestry, so a gap or fork cannot hide off the walked path | the chain-gap, fork, and cycle tests |

`rereviewChainValid`'s one genuinely unique conjunct, `created_at` monotonicity, was **removed** rather
than kept — see below.

**The `rereviewChainValid` declaration is conditional, and both exact-head reviewers were right to
press on it.** Its justification appeals to the head-to-root recursion that `rereviewPredecessor`
performs — but the predecessor-intactness call which performs that recursion is *itself* removable
with the suite green. The two are **individually redundant but jointly load-bearing**: delete either
alone and nothing changes; delete both together and the suite fails. One-mutant-at-a-time mutation
testing is structurally blind to a mutually-redundant pair, so a green harness run must not be read
as proving either guard dispensable. This is recorded here and in the harness rather than resolved by
deleting one of them, because either deletion would leave the other genuinely load-bearing and
unpinned.

### `created_at` carries no ordering guarantee

`chain_version` is the sole ordering authority for a chain: it is unique per root, so ordering by it is
total and replay-stable, which is exactly why `getMemoryCandidateRereviewChain` orders by it.
`created_at` is millisecond resolution and ties are routine — the same reason
`getPendingMemoryCandidatesForWorkspace` needs an `,id` tiebreak — so **nothing may derive order from
it**, and no integrity check depends on it.

The previous write-path monotonicity check was also a write-only invariant: the read path loads one row
and its ancestry, never the sibling ordering that check saw, so a chain stored with backwards
timestamps read as fully intact regardless. Rather than keep an invariant the read path cannot verify,
the requirement is removed and the absence of the guarantee is documented and pinned by a test that
stores a backwards timestamp and asserts the chain still reads, still replays in `chain_version` order,
and remains extendable.

## Status and limitations

Accepted, not resolved:

- Everything the first slice accepted still applies, including the mutable candidate table, the
  unkeyed digests, the `auth_decisions` asymmetry, and the pre-redaction rationale bound.
- **Attribution is outside digest coverage.** Neither packet hashes `reviewer_principal_id`,
  `created_at`, or the row `id` — deliberately, since they are assigned at insert time and hashing
  them would make an idempotent replay depend on write order. For a table whose purpose is recording
  *who* judged, this means any change to the reviewer field is undetectable on read — not merely
  accidental corruption but deliberate mis-attribution: a database writer can reassign a stored
  re-review to a different `reviewer_principal_id` and every digest, ancestry, and replay check still
  passes. This is reproducible by execution, not a theoretical gap.
  Against the stated database-write adversary an extra unkeyed digest would buy nothing, so this is
  documented rather than fixed.
- Per-append validation remains super-linear in chain depth: `storedRereviewIntact` walks head-to-root
  on every append. It is bounded at 64 and is not a denial-of-service vector, but building a
  full-depth chain is measurably slow in the focused suite. Not addressed in this slice.
- **Startup schema validation does not verify CHECK constraints.** `schema-validation.js` registers
  columns by name, the three named unique indexes, and the two immutability triggers. Index and
  trigger validation is strict — normalized SQL text, `unique`, `origin='c'`, `partial=0`, and column
  order are all compared, so a named unique index cannot be silently degraded. But **no CHECK
  constraint is validated at all.** This matters because several guarantees stated above rest on
  CHECKs: the absence of a `promote` decision value, the `chain_version`/`supersedes` pairing, and
  the two self-link bans. If the table were ever created by a path other than this migration,
  `findMissingSchemaObjects` would report the schema as compatible with every CHECK absent. This is
  the pre-existing pattern for `hermes_memory_candidate_reviews` and is not a regression, but the
  confidence placed in those CHECKs elsewhere in this document is not backed by the validator.
- The three unique constraints are declared **twice** — once inline in `CREATE TABLE` and again as
  named `CREATE UNIQUE INDEX` statements — so SQLite maintains two B-trees per constraint. This is
  deliberate and required, not an oversight: `schema-validation.js` pins indexes by name and requires
  `origin='c'`, while inline table constraints produce `origin='u'` autoindexes that it cannot pin.
  The inline constraints are retained so the invariant still holds if the named indexes are ever
  dropped; the named indexes are what startup validation can actually verify.
- The read-side depth bound **is** now independently pinned, by a correctly linked and digest-resealed
  row at depth 65 whose only violated invariant is the bound itself. (The earlier over-depth test did
  not isolate it: its forged row was also refused by the predecessor chain-version check.)
- Some single-line guards remain structurally redundant with a second independent check that catches
  the same forgery. Mutation testing confirms the invariants are pinned collectively — removing a
  whole layer fails the suite — but individual redundant lines are equivalent mutants. This matches
  the defence-in-depth pattern already accepted in Milestone 3B. Where a "guard" turned out to be
  unreachable rather than redundant, it was removed or relocated rather than kept and described as
  enforcement: see the write-path denylist and the second depth assertion above.

## Corrections from review

Two independent exact-head reviews of `0ed5d39` found three defects, all of the same shape — the read
path trusting what the write path had validated — and all now fixed and pinned:

1. **Read-path inheritance enforced only a denylist.** A reviewer demonstrated, against the running
   code, a resealed forgery returning `candidateId: "TOTALLY-OTHER-CANDIDATE"` and a smuggled
   `promotionApproved: true` from `readMemoryCandidateRereview`. Nothing consumed the block, so no
   authority was granted, but the documented allowlist guarantee held on write only. Now enforced
   positively on read by `inheritedContextIntact`.
2. **Replay skipped full intactness validation.** A self-consistent row with a wrong `candidate_id`
   or a broken predecessor pin could return as a successful replay from the write path while the read
   path refused it. Replay now runs the same `storedRereviewIntact` check.
3. **The depth bound was decided after a full ancestry walk**, contradicting a source comment that
   claimed the opposite ordering. The bound now precedes predecessor construction, and the ordering is
   pinned by a test that distinguishes the two refusals.

The sixth pass acted on the one exact-head review of `501251f` that completed. It found no code
defect and no missing coverage; all three findings were documentation accuracy, and all three are
corrected above rather than restated here:

1. The `UNIQUE(root_review_id,chain_version)` claim in the invariants section overstated the index as
   an independent backstop for the head rule. It is not: `chain_version` is derived from the actual
   head rather than from `supersedes`, so with the head rule removed an append violates no unique
   index and silently re-parents. The claim is now scoped to the race it actually covers, matching the
   precise wording already in the source comment and in the committed test rationale.
2. The attribution limitation said "accidental corruption", which understated a gap reproducible by
   execution: a database writer can deliberately re-attribute a stored re-review and every digest,
   ancestry, and replay check still passes. Now stated as deliberate mis-attribution.
3. A stale ordinal ("the seventeenth mutant") survived against a 24-entry mutant list. The mutant is
   now named rather than numbered, so the text cannot drift against the inventory again.

No source file changed in this pass, so the mutant inventory and every count above are unchanged and
were re-run rather than carried over.

- There is still no review queue, no listing route, and no promotion.
- `getPendingMemoryCandidatesForWorkspace` still has no production caller.

## Deferred after this slice

The workspace-scoped review queue, then promotion. Promotion must not inherit `evaluation.correct` as
its authority without an explicit decision, and must not be automatic. Nothing in this slice
activates Gate 4, production routing, live providers, memory retrieval, historical backfill, or
production database provisioning.
