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
import { id, now } from '../shared/util.js';
import { canonicalJson, digest, digestibleValue, canonicalTimestamp } from '../shared/canonical.js';
import { transaction } from '../task-engine/db.js';
import { canReadEvaluation, canCorrectEvaluation, hasCurrentWorkspacePermission } from '../shared/authorization.js';
import { evaluationIsIntact, OUTCOME_EVALUATION_VERSION } from './outcome.js';
import { redactString } from './redaction.js';
import { getMemoryCandidate, getOutcomeEvaluationForRun, insertMemoryCandidateReview,
  getMemoryCandidateReview, getMemoryCandidateReviewForCandidate,
  getMemoryCandidateReviewByIdempotencyKey } from './store.js';

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

// Records one terminal review for one pending candidate. `m3c-v1` permits exactly one review per
// candidate; re-review and successor chains are deferred, so a second decision refuses rather than
// silently superseding a recorded human judgement.
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
