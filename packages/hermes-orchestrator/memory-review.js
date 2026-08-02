// Hermes Milestone 3C: approval-gated memory-candidate review.
//
// A review is an append-only, workspace-isolated record of a human judgement about one Milestone 1
// memory candidate. It is REVIEW-ONLY. This module must never promote a candidate, write memory,
// retrieve memory into any prompt, change routing, provider selection, provider health, task
// execution, approvals, or production behavior, and it never calls the router, executor, provider
// registry, memory service, or the Milestone 3B scorecard module. It has no background job, startup
// hook, workflow-completion hook, historical backfill, or automatic refresh: a review is recorded
// only when a caller explicitly asks for it.
//
// The decision vocabulary is deliberately advisory and contains no `promote` value. Recording
// `recommend_promote` records an opinion; nothing in `m3c-v1` reads it, and the database CHECK
// constraint refuses a promotion-shaped value outright.
//
// The second 3C slice adds RE-REVIEW as an explicit successor: a new append-only row that links to
// the review or successor it supersedes and never overwrites it. Everything above still holds - a
// successor promotes nothing, inherits no authority from its predecessor, and requires a new
// independent decision by a caller who holds `evaluation.correct` at the time of the call.
import { id, now } from '../shared/util.js';
import { canonicalJson, digest, digestibleValue, canonicalTimestamp } from '../shared/canonical.js';
import { transaction } from '../task-engine/db.js';
import { canReadEvaluation, canCorrectEvaluation, hasCurrentWorkspacePermission } from '../shared/authorization.js';
import { evaluationIsIntact, OUTCOME_EVALUATION_VERSION } from './outcome.js';
import { redactString } from './redaction.js';
import { getMemoryCandidate, getOutcomeEvaluationForRun, insertMemoryCandidateReview,
  getMemoryCandidateReview, getMemoryCandidateReviewForCandidate,
  getMemoryCandidateReviewByIdempotencyKey, insertMemoryCandidateRereview,
  getMemoryCandidateRereview, getMemoryCandidateRereviewChain, getMemoryCandidateRereviewHead,
  getMemoryCandidateRereviewByIdempotencyKey } from './store.js';

export const MEMORY_REVIEW_VERSION = 'm3c-v1';
export const MEMORY_REVIEW_DECISION_VERSION = 'hermes-memory-review-v1';
// Advisory only. There is deliberately no `promote`: a decision authorizes nothing and is read by
// nothing in this milestone. Frozen so a caller cannot widen the vocabulary at runtime.
export const MEMORY_REVIEW_DECISIONS = Object.freeze(['recommend_promote', 'reject', 'defer_needs_evidence']);
const MAX_RATIONALE_LENGTH = 2000;
// The exact candidate columns the review pins. Listed explicitly rather than hashing the whole row,
// so a column added to the Milestone 1 table by a later migration cannot silently change the digest
// of every already-stored review and make them all unreadable.
const CANDIDATE_DIGEST_COLUMNS = ['id', 'run_id', 'task_id', 'workspace_id', 'kind', 'scope', 'lesson', 'evidence_ref', 'status', 'promoted_at', 'created_at'];

// --- Public surface ---

// Records the ROOT review for one pending candidate. There is still exactly one root review per
// candidate: a second call refuses rather than silently superseding a recorded human judgement.
// Changing a recorded judgement is done by appending a successor through
// `recordMemoryCandidateRereview` below, which links to this row and never touches it.
export function recordMemoryCandidateReview(principal, candidateId, { decision, rationale, idempotencyKey } = {}) {
  if (!safeId(candidateId)) throw new Error('memory candidate review requires a canonical candidate id');
  if (!safeId(idempotencyKey)) throw new Error('memory candidate review requires a canonical idempotency key');
  if (!MEMORY_REVIEW_DECISIONS.includes(decision)) throw new Error('memory candidate review requires a canonical review decision');
  // A human judgement with no recorded reason is not evidence. Checked before any read so a
  // malformed call cannot be used to probe which candidate ids exist.
  if (typeof rationale !== 'string' || rationale.trim().length === 0 || rationale.length > MAX_RATIONALE_LENGTH) {
    throw new Error('memory candidate review requires a rationale');
  }
  const candidate = getMemoryCandidate(candidateId);
  // Scope comes from the stored candidate row and is never a caller argument, so no caller can widen
  // scope or review into a workspace they were not granted. A candidate whose workspace is NULL or
  // malformed can satisfy no grant and is permanently unreviewable, which is the safe outcome.
  const workspaceId = candidate && safeId(candidate.workspace_id) ? candidate.workspace_id : null;
  // Authorization is decided before the caller learns anything about the candidate, and an absent
  // candidate, an unusable workspace, and a workspace the caller holds no grant in all refuse with
  // ONE message. Differentiating them would let a principal granted in any single workspace probe a
  // well-formed candidate id and learn whether it exists in every other workspace - the read path
  // already collapses these cases, and the record path must not be the weaker of the two. Only a
  // caller already authorized in the candidate's own workspace reaches the diagnostics below.
  //
  // The audit trail stays asymmetric by construction: a denial is audited against the candidate's
  // workspace, and an absent candidate names no workspace to audit against. That residual channel
  // is visible only to a reader of `auth_decisions`, not to the calling principal.
  //
  // Authorization happens BEFORE the transaction opens, so the audited allow/deny decision survives
  // the rollback that any later refusal triggers. Recording persists a permanent immutable row, so
  // it demands the write-capable `evaluation.correct` in addition to `evaluation.read`: a read-only
  // viewer grant must not append human judgements. No new permission is introduced.
  if (workspaceId === null ||
    !canReadEvaluation(principal, workspaceId).allowed ||
    !canCorrectEvaluation(principal, workspaceId).allowed) throw new Error('memory candidate review is not authorized');
  return transaction(() => {
    // Re-proved inside the transaction against current grants, so a grant revoked between the
    // audited decision above and this point refuses. `hasCurrentWorkspacePermission` deliberately
    // does not audit, so the re-proof adds no rows: one recording emits exactly the two audited
    // decisions taken above.
    if (!hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.read') ||
      !hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.correct')) throw new Error('memory candidate review is not authorized');
    const subject = validatedSubject(candidate, workspaceId);
    const content = { decision, rationale: redactString(rationale) };
    const packets = digestPackets(subject, content);
    // Replay: the same key with byte-identical derived content returns the stored row and writes
    // nothing. The same key with different content is an integrity conflict, never an overwrite.
    const replayed = getMemoryCandidateReviewByIdempotencyKey(workspaceId, idempotencyKey);
    if (replayed) {
      if (replayed.content_digest !== packets.contentDigest || replayed.lineage_digest !== packets.lineageDigest) {
        throw new Error('memory candidate review identity conflicts with stored decision');
      }
      return replayed;
    }
    // One terminal review per candidate. Checked explicitly so the caller gets a named refusal
    // rather than a raw UNIQUE-constraint error, and enforced independently by the unique index.
    if (getMemoryCandidateReviewForCandidate(candidateId)) throw new Error('memory candidate review refuses a second decision for an already-reviewed candidate');
    const row = {
      id: id('hmrev'),
      review_version: MEMORY_REVIEW_VERSION,
      decision_version: MEMORY_REVIEW_DECISION_VERSION,
      candidate_id: subject.candidateId,
      workspace_id: workspaceId,
      run_id: subject.runId,
      task_id: subject.taskId,
      decision: content.decision,
      rationale: content.rationale,
      candidate_kind: subject.candidateKind,
      candidate_scope: subject.candidateScope,
      candidate_status_at_review: subject.candidateStatus,
      candidate_digest: subject.candidateDigest,
      evaluation_id: subject.evaluationId,
      evaluation_version: subject.evaluationVersion,
      provenance_digest: subject.provenanceDigest,
      reviewer_principal_id: reviewerPrincipalId(principal),
      idempotency_key: idempotencyKey,
      content_digest: packets.contentDigest,
      lineage_digest: packets.lineageDigest,
      created_at: now(),
    };
    insertMemoryCandidateReview(row);
    return getMemoryCandidateReview(row.id);
  });
}

// The only read surface. Returns null for absent, cross-workspace, and non-intact alike, so a caller
// cannot distinguish them.
export function readMemoryCandidateReview(principal, reviewId) {
  return transaction(() => {
    const review = getMemoryCandidateReview(reviewId);
    if (!review) return null;
    // Authorization precedes the integrity check, which re-reads the candidate row and computes
    // three digests. Both paths return null, so the response body was already indistinguishable -
    // but the work was not. Deciding first means an unauthorized caller causes no candidate read.
    if (!canReadEvaluation(principal, review.workspace_id).allowed) return null;
    if (!storedReviewIntact(review)) return null;
    return {
      id: review.id, workspaceId: review.workspace_id,
      reviewVersion: review.review_version, decisionVersion: review.decision_version,
      candidateId: review.candidate_id, runId: review.run_id, taskId: review.task_id,
      decision: review.decision, rationale: review.rationale,
      candidate: { kind: review.candidate_kind, scope: review.candidate_scope, statusAtReview: review.candidate_status_at_review, digest: review.candidate_digest },
      evaluation: { id: review.evaluation_id, version: review.evaluation_version, provenanceDigest: review.provenance_digest },
      reviewerPrincipalId: review.reviewer_principal_id,
      contentDigest: review.content_digest, lineageDigest: review.lineage_digest,
      createdAt: review.created_at,
    };
  });
}

// --- Subject revalidation ---

// A candidate is reviewable only when it fully revalidates against its own immutable Milestone 3A
// evidence. Unlike Milestone 3B, a failure is scoped to THIS candidate: there is no aggregate, so a
// tampered candidate must never make its workspace's other candidates unreviewable.
function validatedSubject(candidate, workspaceId) {
  if (!safeId(candidate.run_id)) throw new Error('memory candidate review requires a canonical run id');
  if (candidate.task_id !== null && !safeId(candidate.task_id)) throw new Error('memory candidate review refuses a malformed task id');
  // A workspace grant cannot authorize a decision whose blast radius is global. `memory.js` only
  // ever writes 'workspace', so a global candidate is either a future feature or a forgery; both
  // refuse until a milestone decides who may review one.
  if (candidate.scope !== 'workspace') throw new Error('memory candidate review refuses a non-workspace candidate scope');
  // Only a pending candidate is reviewable. This is also the guard that stops 3C from re-reviewing
  // anything a later promotion milestone has touched.
  if (candidate.status !== 'pending') throw new Error('memory candidate review refuses a candidate that is not pending');
  if (candidate.promoted_at !== null) throw new Error('memory candidate review refuses an already-promoted candidate');
  if (!safeId(candidate.kind)) throw new Error('memory candidate review refuses a malformed candidate kind');
  if (typeof candidate.lesson !== 'string' || candidate.lesson.trim().length === 0) throw new Error('memory candidate review refuses an empty candidate lesson');
  if (!canonicalTimestamp(candidate.created_at)) throw new Error('memory candidate review refuses a candidate with a non-canonical timestamp');
  // Lineage to Milestone 3A. A candidate without intact, canonical-version outcome evidence is an
  // opinion about an unverified run, so it fails closed rather than being reviewed on faith.
  const evaluation = getOutcomeEvaluationForRun(candidate.run_id, OUTCOME_EVALUATION_VERSION);
  if (!evaluation) throw new Error('memory candidate review requires an intact outcome evaluation');
  if (evaluation.workspace_id !== workspaceId) throw new Error('memory candidate review refuses a cross-workspace outcome evaluation');
  if (evaluation.evaluation_version !== OUTCOME_EVALUATION_VERSION) throw new Error('memory candidate review refuses a mixed outcome evaluation version');
  if (!evaluationIsIntact(evaluation)) throw new Error('memory candidate review requires an intact outcome evaluation');
  return {
    candidateId: candidate.id, runId: candidate.run_id, taskId: candidate.task_id,
    candidateKind: candidate.kind, candidateScope: candidate.scope, candidateStatus: candidate.status,
    candidateDigest: candidateDigest(candidate),
    evaluationId: evaluation.id, evaluationVersion: evaluation.evaluation_version,
    provenanceDigest: evaluation.provenance_digest,
  };
}

// Pins the candidate row exactly as it read at decision time. `hermes_memory_candidates` carries no
// immutability triggers, so this pin is the only thing that makes a stored review verifiable: it
// turns "reviewed candidate X" into "reviewed candidate X as it then was".
function candidateDigest(candidate) {
  const packet = Object.fromEntries(CANDIDATE_DIGEST_COLUMNS.map((column) => [column, candidate[column] ?? null]));
  if (!digestibleValue(packet)) throw new Error('memory candidate review refuses a non-canonical candidate packet');
  return digest(canonicalJson(packet));
}

// Two digests, mirroring Milestone 3B. `content` is what was decided; `lineage` is what it was
// decided on. Neither covers the row id, the reviewer, or `created_at`, which are assigned at insert
// time - hashing them would make an idempotent replay depend on write order.
function digestPackets(subject, content) {
  const contentPacket = { reviewVersion: MEMORY_REVIEW_VERSION, decisionVersion: MEMORY_REVIEW_DECISION_VERSION, decision: content.decision, rationale: content.rationale, candidateDigest: subject.candidateDigest };
  const lineagePacket = {
    reviewVersion: MEMORY_REVIEW_VERSION, decisionVersion: MEMORY_REVIEW_DECISION_VERSION,
    subject: { candidateId: subject.candidateId, runId: subject.runId, taskId: subject.taskId, candidateKind: subject.candidateKind, candidateScope: subject.candidateScope, candidateStatus: subject.candidateStatus, candidateDigest: subject.candidateDigest },
    evaluation: { id: subject.evaluationId, version: subject.evaluationVersion, provenanceDigest: subject.provenanceDigest },
    content: { decision: content.decision, rationale: content.rationale },
  };
  if (!digestibleValue(contentPacket) || !digestibleValue(lineagePacket)) throw new Error('memory candidate review refuses a non-canonical review packet');
  return { contentDigest: digest(canonicalJson(contentPacket)), lineageDigest: digest(canonicalJson(lineagePacket)) };
}

// Recomputes both digests from the persisted row. A stored review whose content no longer reproduces
// its own digests is corrupt and is unreadable rather than being returned as authentic. This is
// corruption detection over unkeyed SHA-256 of public inputs, NOT tamper resistance against an actor
// who can already write these tables.
function storedReviewIntact(review) {
  if (review.review_version !== MEMORY_REVIEW_VERSION || review.decision_version !== MEMORY_REVIEW_DECISION_VERSION) return false;
  if (!MEMORY_REVIEW_DECISIONS.includes(review.decision)) return false;
  if (!safeId(review.workspace_id) || !safeId(review.candidate_id) || !safeId(review.run_id)) return false;
  if (!canonicalTimestamp(review.created_at)) return false;
  const subject = {
    candidateId: review.candidate_id, runId: review.run_id, taskId: review.task_id,
    candidateKind: review.candidate_kind, candidateScope: review.candidate_scope,
    candidateStatus: review.candidate_status_at_review, candidateDigest: review.candidate_digest,
    evaluationId: review.evaluation_id, evaluationVersion: review.evaluation_version,
    provenanceDigest: review.provenance_digest,
  };
  let packets;
  try { packets = digestPackets(subject, { decision: review.decision, rationale: review.rationale }); } catch { return false; }
  return packets.contentDigest === review.content_digest && packets.lineageDigest === review.lineage_digest;
}

// The reviewer is the server-resolved principal, never a caller-supplied field, so a review cannot
// be attributed to someone else.
function reviewerPrincipalId(principal) {
  const principalId = principal && principal.principalId;
  if (!safeId(principalId)) throw new Error('memory candidate review requires a canonical reviewer principal');
  return principalId;
}

function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }

// --- Milestone 3C, second slice: re-review as an explicit successor ---
//
// A re-review is a NEW append-only row in `hermes_memory_candidate_rereviews` that LINKS to the
// record it supersedes. Nothing historical is ever overwritten: the root review row and every
// earlier successor stay byte-identical, protected by their own immutability triggers, and the whole
// chain remains replayable in `chain_version` order.
//
// This deliberately follows the Milestone 3A correction-chain shape rather than the 3B in-table
// `supersedes_*` shape. The reason is structural, not stylistic: the merged review table declares an
// inline `UNIQUE(candidate_id)`, and SQLite can only drop an inline constraint by rebuilding the
// table - which would mean copying and re-writing historical immutable rows, the exact thing a
// successor chain exists to avoid.
//
// A SUCCESSOR INHERITS NO AUTHORITY. It does not inherit the predecessor's decision, rationale,
// approval, correctness, scorecard result, authorization, or promotion eligibility. The caller must
// supply a fresh decision and a fresh rationale, must hold `evaluation.correct` at the time of the
// call, and the candidate is fully revalidated from scratch. The only thing carried forward is
// `INHERITED_CONTEXT_KEYS` - the subject's identity - copied explicitly and provenance-tracked.
export const MEMORY_REREVIEW_VERSION = 'm3c-r1';
// The complete allowlist of contextual data a successor may carry forward from its predecessor. It
// is subject IDENTITY only: which candidate, from which run and task, of which kind and scope. Every
// judgement-bearing or authority-bearing field is absent by construction, and `deniedInheritance`
// below re-proves that at runtime so widening this list cannot silently smuggle one in.
export const INHERITED_CONTEXT_KEYS = Object.freeze(['candidateId', 'runId', 'taskId', 'candidateKind', 'candidateScope']);
// Fields a successor must NEVER inherit. Checked against the assembled context on every write and on
// every read, so this is an enforced invariant rather than a comment.
const DENIED_INHERITANCE_KEYS = Object.freeze(['decision', 'rationale', 'approval', 'approved', 'authorization', 'authorized', 'permissions', 'scorecard', 'confidenceBand', 'promotion', 'promotionEligible', 'promotedAt', 'status', 'correctness', 'verified']);
// A chain is bounded. Verifying ancestry is inherently super-linear - reading one successor walks to
// the root, and validating a chain of length n verifies every prefix - so an unbounded chain lets an
// authorized principal turn a cheap append into arbitrarily expensive reads for its whole workspace,
// and would eventually overflow the verification recursion before any refusal could fire. Milestone
// 3B's accepted limitation was exactly this ("derivation is unbounded and must be bounded before any
// derivation API ships"); this slice does not repeat it. The bound is enforced on WRITE, so a chain
// can never grow past it, and again on READ, so a row written around the service by a database-write
// actor is unreadable rather than a way to reintroduce the same cost.
export const MAX_REREVIEW_CHAIN_DEPTH = 64;

// Appends one successor to a candidate's review chain.
//
// `supersedes` is REQUIRED and must name the chain's current head exactly - the root review id when
// no successor exists yet, otherwise the latest successor id. Naming anything else is a stale or
// conflicting predecessor and refuses, which is what makes two concurrent re-reviewers of the same
// head resolve to one winner and one explicit refusal rather than to a fork.
export function recordMemoryCandidateRereview(principal, rootReviewId, { supersedes, decision, rationale, idempotencyKey } = {}) {
  // Shape first, before any read, so a malformed call cannot probe which review ids exist.
  if (!safeId(rootReviewId)) throw new Error('memory candidate re-review requires a canonical root review id');
  if (!safeId(supersedes)) throw new Error('memory candidate re-review requires a canonical predecessor id');
  if (!safeId(idempotencyKey)) throw new Error('memory candidate re-review requires a canonical idempotency key');
  if (!MEMORY_REVIEW_DECISIONS.includes(decision)) throw new Error('memory candidate re-review requires a canonical review decision');
  // A successor never inherits the predecessor's rationale. An unexplained reversal of a recorded
  // human judgement is worse evidence than the judgement it replaces.
  if (typeof rationale !== 'string' || rationale.trim().length === 0 || rationale.length > MAX_RATIONALE_LENGTH) {
    throw new Error('memory candidate re-review requires a rationale');
  }
  const root = getMemoryCandidateReview(rootReviewId);
  const workspaceId = root && safeId(root.workspace_id) ? root.workspace_id : null;
  // Same single-message collapse as the record path: an absent root, an unusable workspace, and a
  // workspace the caller holds no grant in are indistinguishable to the caller, so a principal
  // granted in one workspace cannot probe which reviews exist in every other one. Authorization is
  // decided before the transaction opens so the audited decision survives the rollback that any
  // later refusal triggers, and demands the write-capable `evaluation.correct`: appending a
  // successor is a permanent human judgement, not a read.
  if (workspaceId === null ||
    !canReadEvaluation(principal, workspaceId).allowed ||
    !canCorrectEvaluation(principal, workspaceId).allowed) throw new Error('memory candidate re-review is not authorized');
  return transaction(() => {
    // Re-proved against current grants inside the transaction, so a grant revoked between the
    // audited decision and this point refuses. Authority is per-call and is never carried forward
    // from whoever recorded the predecessor.
    if (!hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.read') ||
      !hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.correct')) throw new Error('memory candidate re-review is not authorized');
    // A chain may only be rooted in an intact, canonical-version root review. A corrupt root makes
    // every successor's ancestry unverifiable, so it fails closed rather than being extended.
    if (!storedReviewIntact(root)) throw new Error('memory candidate re-review requires an intact root review');
    // Replay: the same key with byte-identical derived content returns the stored row and writes
    // nothing. The same key with different content is an integrity conflict, never an overwrite.
    const replayed = getMemoryCandidateRereviewByIdempotencyKey(workspaceId, idempotencyKey);
    if (replayed) {
      // Replay and normal read MUST agree on what a valid stored successor is. Re-deriving the row's
      // own digests only proves it is self-consistent: every input to `replayedIdentity` comes from
      // the row's own columns, so a row forged with a foreign `candidate_id`, a broken predecessor
      // pin, or invalid ancestry reproduces its digests perfectly and would otherwise be handed back
      // as a successful replay while `readMemoryCandidateRereview` refuses the very same row. The
      // full structural check against the real root is what closes that disagreement.
      if (!storedRereviewIntact(replayed, root)) throw new Error('memory candidate re-review refuses a non-intact stored decision');
      const replayedPackets = rereviewPackets(replayedIdentity(replayed));
      if (replayed.content_digest !== replayedPackets.contentDigest || replayed.lineage_digest !== replayedPackets.lineageDigest ||
        replayed.root_review_id !== rootReviewId || replayed.decision !== decision ||
        replayed.rationale !== redactString(rationale) || predecessorIdOf(replayed) !== supersedes) {
        throw new Error('memory candidate re-review identity conflicts with stored decision');
      }
      return replayed;
    }
    const head = getMemoryCandidateRereviewHead(rootReviewId);
    // The depth bound is decided from the stored head's own `chain_version`, BEFORE any ancestry is
    // verified. `rereviewPredecessor` below walks the entire chain to the root, so checking depth
    // after it would mean a full-depth verification pass had already run on a chain that is refused
    // anyway - which is precisely what the bound exists to prevent. `Number.isSafeInteger` guards a
    // forged non-numeric `chain_version`; the intactness check inside `rereviewPredecessor` then
    // re-proves the value independently.
    const headChainVersion = head ? Number(head.chain_version) : 0;
    if (!Number.isSafeInteger(headChainVersion) || headChainVersion < 0 ||
      headChainVersion + 1 > MAX_REREVIEW_CHAIN_DEPTH) throw new Error('memory candidate re-review refuses a chain beyond the maximum depth');
    const predecessor = head ? rereviewPredecessor(head, workspaceId, root) : rootPredecessor(root);
    // The caller must name the CURRENT head. Anything else - the root after a successor already
    // exists, a superseded ancestor, a successor of some other chain, or the row's own future id -
    // is a stale or conflicting predecessor. This is what turns two concurrent re-reviews of the
    // same head into one winner and one explicit refusal instead of a fork; the
    // UNIQUE(root_review_id,chain_version) index enforces the same thing independently, so a race
    // that slips past this check still cannot produce a second sibling.
    if (predecessor.id !== supersedes) throw new Error('memory candidate re-review refuses a stale or conflicting predecessor');
    // Self-linking is unreachable through the head rule above - the new row's id does not exist yet -
    // and is refused again by the database CHECKs. Cycles are unreachable because `chain_version`
    // strictly increases over an append-only table with no update or delete path.
    //
    // Depth was already bounded above, from the head's own `chain_version`, before any ancestry walk
    // ran. It is deliberately NOT re-asserted here: `rereviewPredecessor` derives `chainVersion` from
    // the very same row the bound was computed from, so a second check is unreachable rather than
    // defence in depth - it would be a guard no input can trip, which is exactly the kind of claim
    // this slice is removing rather than adding.
    //
    // Ancestry must verify end to end before it is extended. A chain with a gap, a fork, a foreign
    // root, a broken digest pin, or a cross-workspace link is not a chain that may grow.
    if (head && !rereviewChainValid(root, getMemoryCandidateRereviewChain(rootReviewId))) {
      throw new Error('memory candidate re-review refuses an invalid predecessor chain');
    }
    // The candidate is revalidated FROM SCRATCH against live Milestone 3A evidence. A successor
    // never inherits the predecessor's finding that the subject was correct: a candidate that has
    // since been promoted, altered, or lost its intact evaluation is no longer re-reviewable, even
    // though its predecessor was recorded when it was.
    const candidate = getMemoryCandidate(root.candidate_id);
    if (!candidate) throw new Error('memory candidate re-review requires an existing candidate');
    // Cross-workspace linking, from the other direction: the candidate must live in the same
    // workspace as the chain it is being re-reviewed in.
    if (candidate.workspace_id !== workspaceId) throw new Error('memory candidate re-review refuses a cross-workspace candidate');
    const subject = validatedSubject(candidate, workspaceId);
    if (subject.candidateId !== root.candidate_id) throw new Error('memory candidate re-review refuses a subject that is not the reviewed candidate');
    const inherited = inheritedContext(predecessor, subject);
    const content = { decision, rationale: redactString(rationale) };
    const chainVersion = predecessor.chainVersion + 1;
    const identity = { rootReviewId, chainVersion, predecessor, subject, content, inherited };
    const packets = rereviewPackets(identity);
    const row = {
      id: id('hmrrev'),
      rereview_version: MEMORY_REREVIEW_VERSION,
      decision_version: MEMORY_REVIEW_DECISION_VERSION,
      root_review_id: rootReviewId,
      // NULL at depth 1: the first successor supersedes the root review itself, which lives in the
      // other table. The database CHECK binds this to `chain_version`, so ancestry is never ambiguous.
      supersedes_rereview_id: head ? head.id : null,
      chain_version: chainVersion,
      candidate_id: subject.candidateId,
      workspace_id: workspaceId,
      run_id: subject.runId,
      task_id: subject.taskId,
      decision: content.decision,
      rationale: content.rationale,
      candidate_kind: subject.candidateKind,
      candidate_scope: subject.candidateScope,
      candidate_status_at_review: subject.candidateStatus,
      candidate_digest: subject.candidateDigest,
      evaluation_id: subject.evaluationId,
      evaluation_version: subject.evaluationVersion,
      provenance_digest: subject.provenanceDigest,
      // Pins the superseded record exactly as it read at decision time. Together with the head rule
      // this is what makes "stale predecessor" detectable rather than merely unlikely.
      predecessor_content_digest: predecessor.contentDigest,
      predecessor_lineage_digest: predecessor.lineageDigest,
      inherited_context: canonicalJson(inherited),
      reviewer_principal_id: reviewerPrincipalId(principal),
      idempotency_key: idempotencyKey,
      content_digest: packets.contentDigest,
      lineage_digest: packets.lineageDigest,
      created_at: now(),
    };
    insertMemoryCandidateRereview(row);
    return getMemoryCandidateRereview(row.id);
  });
}

// The read surface for a successor. Byte-parallel to `readMemoryCandidateReview`: returns null for
// absent, cross-workspace, and non-intact alike, so a caller cannot distinguish them, and authorizes
// before doing any integrity work.
export function readMemoryCandidateRereview(principal, rereviewId) {
  return transaction(() => {
    const rereview = getMemoryCandidateRereview(rereviewId);
    if (!rereview) return null;
    if (!canReadEvaluation(principal, rereview.workspace_id).allowed) return null;
    const root = getMemoryCandidateReview(rereview.root_review_id);
    if (!root || root.workspace_id !== rereview.workspace_id || !storedReviewIntact(root)) return null;
    if (!storedRereviewIntact(rereview, root)) return null;
    let inherited;
    try { inherited = JSON.parse(rereview.inherited_context); } catch { return null; }
    return {
      id: rereview.id, workspaceId: rereview.workspace_id,
      rereviewVersion: rereview.rereview_version, decisionVersion: rereview.decision_version,
      rootReviewId: rereview.root_review_id, supersedesRereviewId: rereview.supersedes_rereview_id,
      chainVersion: Number(rereview.chain_version),
      candidateId: rereview.candidate_id, runId: rereview.run_id, taskId: rereview.task_id,
      decision: rereview.decision, rationale: rereview.rationale,
      candidate: { kind: rereview.candidate_kind, scope: rereview.candidate_scope, statusAtReview: rereview.candidate_status_at_review, digest: rereview.candidate_digest },
      evaluation: { id: rereview.evaluation_id, version: rereview.evaluation_version, provenanceDigest: rereview.provenance_digest },
      predecessor: { id: predecessorIdOf(rereview), kind: rereview.supersedes_rereview_id ? 'rereview' : 'review', contentDigest: rereview.predecessor_content_digest, lineageDigest: rereview.predecessor_lineage_digest },
      inheritedContext: inherited,
      reviewerPrincipalId: rereview.reviewer_principal_id,
      contentDigest: rereview.content_digest, lineageDigest: rereview.lineage_digest,
      createdAt: rereview.created_at,
    };
  });
}

// --- Chain internals ---

// The record a successor at depth 1 supersedes: the root review itself, in the other table.
function rootPredecessor(root) {
  return { id: root.id, kind: 'review', chainVersion: 0, candidateId: root.candidate_id, workspaceId: root.workspace_id,
    runId: root.run_id, taskId: root.task_id, candidateKind: root.candidate_kind, candidateScope: root.candidate_scope,
    contentDigest: root.content_digest, lineageDigest: root.lineage_digest };
}

// The record a deeper successor supersedes: the current head of the chain. Re-verified against the
// root here rather than trusted, so a head that drifted workspace or candidate cannot be extended.
function rereviewPredecessor(head, workspaceId, root) {
  if (head.workspace_id !== workspaceId) throw new Error('memory candidate re-review refuses a cross-workspace predecessor');
  if (head.candidate_id !== root.candidate_id) throw new Error('memory candidate re-review refuses a predecessor for a different candidate');
  if (!storedRereviewIntact(head, root)) throw new Error('memory candidate re-review requires an intact predecessor');
  return { id: head.id, kind: 'rereview', chainVersion: Number(head.chain_version), candidateId: head.candidate_id,
    workspaceId: head.workspace_id, runId: head.run_id, taskId: head.task_id, candidateKind: head.candidate_kind,
    candidateScope: head.candidate_scope, contentDigest: head.content_digest, lineageDigest: head.lineage_digest };
}

// The id of whatever a stored successor supersedes: its predecessor successor, or the root review at
// depth 1. Derived rather than stored twice, so the two can never disagree.
function predecessorIdOf(rereview) { return rereview.supersedes_rereview_id ?? rereview.root_review_id; }

// The only data a successor carries forward. Every value is copied from the PREDECESSOR and then
// required to equal the freshly revalidated subject: a mismatch means the chain and the live
// candidate disagree about what is being reviewed, which is ambiguous ancestry and refuses. The
// provenance block records exactly what was copied and from where, so an auditor never has to infer it.
function inheritedContext(predecessor, subject) {
  const context = Object.fromEntries(INHERITED_CONTEXT_KEYS.map((key) => [key, predecessor[key] ?? null]));
  for (const key of INHERITED_CONTEXT_KEYS) {
    if (context[key] !== (subject[key] ?? null)) throw new Error('memory candidate re-review refuses inherited context that disagrees with the candidate');
  }
  const inherited = {
    inheritedVersion: MEMORY_REREVIEW_VERSION,
    keys: [...INHERITED_CONTEXT_KEYS],
    values: context,
    provenance: { predecessorId: predecessor.id, predecessorKind: predecessor.kind, predecessorChainVersion: predecessor.chainVersion,
      predecessorContentDigest: predecessor.contentDigest, predecessorLineageDigest: predecessor.lineageDigest },
  };
  if (!deniedInheritanceAbsent(inherited)) throw new Error('memory candidate re-review refuses inherited authority');
  if (!digestibleValue(inherited)) throw new Error('memory candidate re-review refuses a non-canonical inherited context');
  return inherited;
}

// Re-proves at runtime that no judgement-bearing or authority-bearing key reached the carried
// context, at any depth.
//
// On the WRITE path this is defence in depth and nothing more, and is documented as such rather than
// claimed as an enforced runtime invariant: `inheritedContext` assembles `inherited` entirely from
// frozen literals - `INHERITED_CONTEXT_KEYS`, a fixed provenance key set, and scalar leaves - so no
// caller-controlled key name can reach it and this check cannot fail for any input. The condition it
// really guards is a future widening of `INHERITED_CONTEXT_KEYS` into a denied name, which is a
// static property of this module and is therefore asserted once at load below, where it is actually
// decidable. On the READ path, where the stored blob IS attacker-reachable, it is load-bearing.
function deniedInheritanceAbsent(value) {
  if (Array.isArray(value)) return value.every(deniedInheritanceAbsent);
  if (value && typeof value === 'object') {
    return Object.entries(value).every(([key, nested]) => !DENIED_INHERITANCE_KEYS.includes(key) && deniedInheritanceAbsent(nested));
  }
  return true;
}

// The column each inherited key must equal on the stored row. Inheritance is subject identity, and
// the row records that same identity in its own columns, so the carried block is fully determined -
// which is what makes positive verification on read possible at all.
const INHERITED_CONTEXT_COLUMNS = Object.freeze({
  candidateId: 'candidate_id', runId: 'run_id', taskId: 'task_id', candidateKind: 'candidate_kind', candidateScope: 'candidate_scope',
});
const INHERITED_PROVENANCE_KEYS = Object.freeze(['predecessorId', 'predecessorKind', 'predecessorChainVersion', 'predecessorContentDigest', 'predecessorLineageDigest']);
const INHERITED_TOP_LEVEL_KEYS = Object.freeze(['inheritedVersion', 'keys', 'values', 'provenance']);
// Decidable statically, so it is decided once here rather than pretended to be a runtime check on a
// value that cannot vary. Widening `INHERITED_CONTEXT_KEYS` into a denied name, or letting it drift
// out of step with the column map, fails the module at load instead of silently weakening a chain.
const sameKeys = (a, b) => a.length === b.length && a.every((key, index) => key === b[index]);
// Exported as a pure predicate rather than written inline, so the invariant can be exercised directly
// with a deliberately widened allowlist instead of only being observed as "the module loaded".
export function inheritanceAllowlistDisjoint(allowlist = INHERITED_CONTEXT_KEYS, denied = DENIED_INHERITANCE_KEYS, columns = INHERITED_CONTEXT_COLUMNS) {
  if (allowlist.some((key) => denied.includes(key))) return false;
  if (INHERITED_PROVENANCE_KEYS.some((key) => denied.includes(key))) return false;
  return sameKeys([...allowlist], Object.keys(columns));
}
if (!inheritanceAllowlistDisjoint()) {
  throw new Error('memory candidate re-review inheritance allowlist is not disjoint from the denied set');
}

// Positive verification of a STORED inherited-context blob: it must be exactly the block this module
// would have written for this row, and nothing else.
//
// A denylist alone is not enough here and never can be. The digests are unkeyed SHA-256 over public
// inputs, so a database-write actor - explicitly inside the threat model - can rewrite
// `inherited_context` and recompute the row's own digests to match. A denylist only rejects the key
// names it happens to enumerate, and the forger chooses the names; anything unlisted rides through
// to the API response, including values contradicting the row's own candidate identity. So the shape
// is pinned exhaustively: exact top-level keys, exact allowlisted key set, every value equal to the
// column it claims to mirror, and provenance equal to the pin the row already carries.
function inheritedContextIntact(inherited, rereview, chainVersion) {
  if (!inherited || typeof inherited !== 'object' || Array.isArray(inherited)) return false;
  if (!sameKeys(Object.keys(inherited).sort(), [...INHERITED_TOP_LEVEL_KEYS].sort())) return false;
  if (inherited.inheritedVersion !== MEMORY_REREVIEW_VERSION) return false;
  // The declared key list must be the allowlist itself, in order - not a subset, superset, or permutation.
  if (!Array.isArray(inherited.keys) || !sameKeys(inherited.keys, [...INHERITED_CONTEXT_KEYS])) return false;
  const values = inherited.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  // Exact key set: a non-allowlisted key present here is a forgery even if its name is not denied.
  if (!sameKeys(Object.keys(values).sort(), [...INHERITED_CONTEXT_KEYS].sort())) return false;
  for (const key of INHERITED_CONTEXT_KEYS) {
    if (values[key] !== (rereview[INHERITED_CONTEXT_COLUMNS[key]] ?? null)) return false;
  }
  const provenance = inherited.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false;
  if (!sameKeys(Object.keys(provenance).sort(), [...INHERITED_PROVENANCE_KEYS].sort())) return false;
  // Provenance is fully determined by the row's own predecessor columns, so it is checked against
  // them rather than merely being present.
  return provenance.predecessorId === predecessorIdOf(rereview) &&
    provenance.predecessorKind === (rereview.supersedes_rereview_id ? 'rereview' : 'review') &&
    provenance.predecessorChainVersion === chainVersion - 1 &&
    provenance.predecessorContentDigest === rereview.predecessor_content_digest &&
    provenance.predecessorLineageDigest === rereview.predecessor_lineage_digest;
}

// Two digests, mirroring the root review. `content` is what was decided; `lineage` is what it was
// decided on, and here that includes the predecessor pin and the carried context. `chain_version` IS
// hashed, unlike Milestone 3B's `scope_version`, because it is fully determined by the caller-named
// predecessor rather than by write order - so hashing it cannot make a legitimate replay diverge.
function rereviewPackets({ rootReviewId, chainVersion, predecessor, subject, content, inherited }) {
  const predecessorPacket = { id: predecessor.id, kind: predecessor.kind, chainVersion: predecessor.chainVersion,
    contentDigest: predecessor.contentDigest, lineageDigest: predecessor.lineageDigest };
  const contentPacket = { rereviewVersion: MEMORY_REREVIEW_VERSION, decisionVersion: MEMORY_REVIEW_DECISION_VERSION,
    rootReviewId, chainVersion, decision: content.decision, rationale: content.rationale,
    candidateDigest: subject.candidateDigest, predecessor: predecessorPacket };
  const lineagePacket = {
    rereviewVersion: MEMORY_REREVIEW_VERSION, decisionVersion: MEMORY_REVIEW_DECISION_VERSION,
    rootReviewId, chainVersion, predecessor: predecessorPacket,
    subject: { candidateId: subject.candidateId, runId: subject.runId, taskId: subject.taskId, candidateKind: subject.candidateKind, candidateScope: subject.candidateScope, candidateStatus: subject.candidateStatus, candidateDigest: subject.candidateDigest },
    evaluation: { id: subject.evaluationId, version: subject.evaluationVersion, provenanceDigest: subject.provenanceDigest },
    inherited,
    content: { decision: content.decision, rationale: content.rationale },
  };
  if (!digestibleValue(contentPacket) || !digestibleValue(lineagePacket)) throw new Error('memory candidate re-review refuses a non-canonical review packet');
  return { contentDigest: digest(canonicalJson(contentPacket)), lineageDigest: digest(canonicalJson(lineagePacket)) };
}

// Rebuilds the packet inputs from a persisted successor, so a stored row can be re-derived and
// checked against its own digests without trusting anything but its own columns.
function replayedIdentity(rereview) {
  let inherited;
  try { inherited = JSON.parse(rereview.inherited_context); } catch { inherited = null; }
  return {
    rootReviewId: rereview.root_review_id, chainVersion: Number(rereview.chain_version),
    predecessor: { id: predecessorIdOf(rereview), kind: rereview.supersedes_rereview_id ? 'rereview' : 'review',
      chainVersion: Number(rereview.chain_version) - 1,
      contentDigest: rereview.predecessor_content_digest, lineageDigest: rereview.predecessor_lineage_digest },
    subject: { candidateId: rereview.candidate_id, runId: rereview.run_id, taskId: rereview.task_id,
      candidateKind: rereview.candidate_kind, candidateScope: rereview.candidate_scope,
      candidateStatus: rereview.candidate_status_at_review, candidateDigest: rereview.candidate_digest,
      evaluationId: rereview.evaluation_id, evaluationVersion: rereview.evaluation_version, provenanceDigest: rereview.provenance_digest },
    content: { decision: rereview.decision, rationale: rereview.rationale },
    inherited,
  };
}

// A stored successor is readable only when it re-derives its own digests AND its structural link to
// the root holds. The structural half cannot be covered by a digest the row hashes about itself -
// that would only prove the row is self-consistent - so it is validated against the real root.
function storedRereviewIntact(rereview, root) {
  if (rereview.rereview_version !== MEMORY_REREVIEW_VERSION || rereview.decision_version !== MEMORY_REVIEW_DECISION_VERSION) return false;
  if (!MEMORY_REVIEW_DECISIONS.includes(rereview.decision)) return false;
  if (!safeId(rereview.id) || !safeId(rereview.workspace_id) || !safeId(rereview.candidate_id) || !safeId(rereview.run_id)) return false;
  if (!safeId(rereview.root_review_id) || rereview.root_review_id !== root.id) return false;
  if (!canonicalTimestamp(rereview.created_at)) return false;
  const chainVersion = Number(rereview.chain_version);
  // The read-side half of the depth bound. This also makes the recursion below provably terminating
  // in a bounded number of frames rather than merely eventually, whatever is in the table.
  if (!Number.isSafeInteger(chainVersion) || chainVersion < 1 || chainVersion > MAX_REREVIEW_CHAIN_DEPTH) return false;
  // Depth and parent must agree: depth 1 supersedes the root and names no successor; every deeper
  // row must name one. Either half alone would leave ancestry ambiguous.
  if (rereview.supersedes_rereview_id === null) { if (chainVersion !== 1) return false; }
  else if (chainVersion === 1 || !safeId(rereview.supersedes_rereview_id)) return false;
  // No self-link, in either direction.
  if (rereview.supersedes_rereview_id === rereview.id || rereview.root_review_id === rereview.id) return false;
  // Same workspace and same candidate as the root: a chain may never cross either boundary.
  if (rereview.workspace_id !== root.workspace_id || rereview.candidate_id !== root.candidate_id) return false;
  const identity = replayedIdentity(rereview);
  // Allowlist FIRST, denylist second. The positive check is what actually constrains the blob: it
  // pins the exact shape and requires every carried value to equal the row's own identity columns,
  // so a forged key or a value contradicting the row is refused whatever it is named. The denylist
  // is retained behind it as defence in depth against a denied name appearing inside an otherwise
  // well-shaped block.
  if (!inheritedContextIntact(identity.inherited, rereview, chainVersion)) return false;
  if (!deniedInheritanceAbsent(identity.inherited)) return false;
  // The predecessor pin must match the record actually named, so an altered ancestor is detectable.
  const predecessor = chainVersion === 1 ? root : getMemoryCandidateRereview(rereview.supersedes_rereview_id);
  if (!predecessor) return false;
  if (predecessor.content_digest !== rereview.predecessor_content_digest ||
    predecessor.lineage_digest !== rereview.predecessor_lineage_digest) return false;
  if (chainVersion > 1 && (Number(predecessor.chain_version) !== chainVersion - 1 ||
    predecessor.root_review_id !== rereview.root_review_id ||
    predecessor.workspace_id !== rereview.workspace_id)) return false;
  // (Provenance, including the predecessor id, is verified exhaustively by `inheritedContextIntact`
  // above against the row's own predecessor columns.)
  // Ancestry is verified ALL THE WAY to the root, not one hop. A single hop is not enough: a
  // predecessor's own digests do not cover its `supersedes_rereview_id`, so an ancestor could be
  // re-pointed into a cycle or onto a foreign chain while every descendant's pin still matched.
  // Recursion terminates because each step requires `chain_version` to decrease by exactly one.
  if (chainVersion > 1 && !storedRereviewIntact(predecessor, root)) return false;
  let packets;
  try { packets = rereviewPackets(identity); } catch { return false; }
  return packets.contentDigest === rereview.content_digest && packets.lineageDigest === rereview.lineage_digest;
}

// The whole chain, verified as a chain rather than row by row: gap-free `chain_version` from 1, each
// row naming exactly its immediate predecessor, one root, one workspace, one candidate, and
// non-decreasing timestamps. A fork or a gap fails here even if every individual row is intact.
function rereviewChainValid(root, chain) {
  return chain.every((row, index) => Number(row.chain_version) === index + 1 &&
    row.supersedes_rereview_id === (index ? chain[index - 1].id : null) &&
    row.root_review_id === root.id && row.workspace_id === root.workspace_id && row.candidate_id === root.candidate_id &&
    storedRereviewIntact(row, root) &&
    (!index || Date.parse(row.created_at) >= Date.parse(chain[index - 1].created_at)));
}
