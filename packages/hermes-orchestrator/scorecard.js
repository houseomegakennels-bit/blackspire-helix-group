// Hermes Milestone 3B: verified scorecards.
//
// A scorecard is a deterministic, append-only, workspace-isolated read model over intact Milestone
// 3A evidence. It is learning-quality evidence, never an execution control. This module must never
// change routing, provider selection, provider health, task execution, approvals, memory-candidate
// status, or production behavior, and it never calls the router, executor, provider registry, or
// memory service. It has no background job, startup hook, workflow-completion hook, historical
// backfill, or automatic refresh: derivation happens only when a caller explicitly asks for it.
import { id, now } from '../shared/util.js';
import { canonicalJson, digest, digestibleValue } from '../shared/canonical.js';
import { transaction, all } from '../task-engine/db.js';
import { canReadEvaluation, canCorrectEvaluation, hasCurrentWorkspacePermission } from '../shared/authorization.js';
import { evaluationIsIntact, OUTCOME_EVALUATION_VERSION } from './outcome.js';
import { getOutcomeEvaluation, getOutcomeCorrections, getOutcomeSourceEvents, getRoutingDecision,
  insertVerifiedScorecard, getVerifiedScorecard, getVerifiedScorecardSources,
  getVerifiedScorecardByIdentity, getVerifiedScorecardScopeHead } from './store.js';

export const SCORECARD_VERSION = 'm3b-v1';
export const SCORECARD_DERIVATION_VERSION = 'hermes-scorecard-derivation-v1';
// Dimension values are `safeId`-shaped, and `*` is outside that character set, so this sentinel can
// never collide with a real provider, agent, or capability. Dimension columns are NOT NULL because
// SQLite treats NULLs as distinct in a UNIQUE index, which would silently permit duplicate
// snapshots for the same scope.
export const UNKNOWN_DIMENSION = '*';
// Sample-size bands only. They describe how much evidence exists, never whether a provider or agent
// is good, and they authorize nothing.
export const CONFIDENCE_THRESHOLDS = Object.freeze({ limited: 5, established: 20 });

const ACCEPTANCE_EVENTS = new Set(['accepted', 'rejected', 'partially_accepted']);
const EVENT_COUNTERS = Object.freeze({ accepted: 'accepted_count', rejected: 'rejected_count', partially_accepted: 'partially_accepted_count', rollback: 'rollback_count', follow_up_verification: 'follow_up_verification_count', stability_confirmed: 'stability_confirmed_count', regression_linked: 'regression_linked_count' });

// `insufficient` is an explicit state, not an absence of data and not a zero score. A caller that
// cannot distinguish it from a real result must not use the scorecard at all.
export function confidenceBand(sourceCount) {
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0) throw new Error('verified scorecard refuses a malformed source count');
  if (sourceCount < CONFIDENCE_THRESHOLDS.limited) return 'insufficient';
  return sourceCount < CONFIDENCE_THRESHOLDS.established ? 'limited' : 'established';
}

// Derives every dimension group in one workspace up to an explicit canonical cutoff tuple.
//
// Deriving twice over an identical scope, cutoff, version, and ordered lineage returns the stored
// snapshots without writing. A stored snapshot whose identity matches but whose derived content
// differs is an integrity error, never a silent overwrite and never a silently stale read.
export function deriveVerifiedScorecards(principal, { workspaceId, cutoff, scorecardVersion = SCORECARD_VERSION } = {}) {
  if (scorecardVersion !== SCORECARD_VERSION) throw new Error('verified scorecard requires the canonical scorecard version');
  if (!safeId(workspaceId)) throw new Error('verified scorecard requires a canonical workspace id');
  if (!cutoff || !canonicalTimestamp(cutoff.createdAt) || !safeId(cutoff.id)) throw new Error('verified scorecard requires a canonical cutoff tuple');
  // Authorization happens BEFORE the transaction opens, so the audited allow/deny decision survives
  // the rollback that any later refusal triggers. Deriving is a persisting operation, so it demands
  // the write-capable `evaluation.correct` in addition to `evaluation.read`: a read-only viewer
  // grant must not be able to append permanent, immutable rows. No new permission is introduced.
  if (!canReadEvaluation(principal, workspaceId).allowed) throw new Error('verified scorecard derivation is not authorized');
  if (!canCorrectEvaluation(principal, workspaceId).allowed) throw new Error('verified scorecard derivation is not authorized');
  return transaction(() => {
    const derivationEpoch = Date.now();
    if (Date.parse(cutoff.createdAt) > derivationEpoch) throw new Error('verified scorecard refuses a future cutoff');
    // Re-proved inside the transaction without emitting a second audit row, exactly as Milestone 3A
    // does for corrections, so one logical operation records one decision.
    if (!hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.read') ||
      !hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.correct')) throw new Error('verified scorecard derivation is not authorized');
    const sources = selectSources(workspaceId, cutoff).map((evaluation) => validatedSource(evaluation, workspaceId, cutoff, derivationEpoch));
    const groups = new Map();
    for (const source of sources) {
      const key = canonicalJson(source.dimensions);
      if (!groups.has(key)) groups.set(key, { dimensions: source.dimensions, sources: [] });
      groups.get(key).sources.push(source);
    }
    // Group iteration order follows source order, so groups are sorted into a total order by their
    // canonical dimension key before anything is derived or persisted. Without this, the same
    // sources supplied in a different order would produce a different write order.
    return [...groups.entries()].sort(([left], [right]) => compareStrings(left, right))
      .map(([, group]) => persistGroup(group, workspaceId, cutoff, scorecardVersion));
  });
}

// Read surface. It reuses the canonical `evaluation.read` permission in the workspace stored on the
// snapshot itself; there is no scorecard-specific permission and no caller-supplied workspace.
export function readVerifiedScorecard(principal, scorecardId) {
  return transaction(() => {
    const scorecard = getVerifiedScorecard(scorecardId);
    if (!scorecard || !storedScorecardIntact(scorecard)) return null;
    if (!canReadEvaluation(principal, scorecard.workspace_id).allowed) return null;
    const sources = getVerifiedScorecardSources(scorecard.id);
    return {
      id: scorecard.id, workspaceId: scorecard.workspace_id,
      scorecardVersion: scorecard.scorecard_version, derivationVersion: scorecard.derivation_version,
      dimensions: { providerId: scorecard.dimension_provider_id, agentId: scorecard.dimension_agent_id, capability: scorecard.dimension_capability, classification: scorecard.dimension_classification },
      cutoff: { createdAt: scorecard.cutoff_created_at, id: scorecard.cutoff_evaluation_id },
      scopeVersion: scorecard.scope_version, supersedesScorecardId: scorecard.supersedes_scorecard_id,
      confidenceBand: scorecard.confidence_band, metrics: metricsOf(scorecard),
      lineageDigest: scorecard.lineage_digest, createdAt: scorecard.created_at,
      sources: sources.map((source) => ({ seq: source.seq, evaluationId: source.evaluation_id, provenanceDigest: source.provenance_digest })),
    };
  });
}

// --- Source selection and revalidation ---

// The cutoff is applied as a `(created_at, id)` tuple comparison, inclusive at the boundary, so
// evaluations sharing a timestamp cannot make membership nondeterministic. `created_at` is always a
// fixed-width ISO-8601 UTC string, so SQLite's BINARY collation orders it chronologically.
//
// Selection deliberately does NOT filter on evaluation_version. Filtering it in SQL would turn a
// mixed or tampered version into a silently skipped row, which would make a snapshot look cleaner
// than the evidence supports; instead every row in scope is selected and a non-canonical version
// fails the whole snapshot closed.
function selectSources(workspaceId, cutoff) {
  return all(`SELECT * FROM hermes_outcome_evaluations WHERE workspace_id=? AND (created_at<? OR (created_at=? AND id<=?)) ORDER BY created_at,id`,
    [workspaceId, cutoff.createdAt, cutoff.createdAt, cutoff.id]);
}

// A source is accepted only when it fully revalidates. A source that fails any check fails the
// whole snapshot; it is never skipped, because silently dropping evidence would make a scorecard
// look better than the record supports.
function validatedSource(evaluation, workspaceId, cutoff, derivationEpoch) {
  if (evaluation.workspace_id !== workspaceId) throw new Error('verified scorecard refuses a cross-workspace source evaluation');
  if (evaluation.evaluation_version !== OUTCOME_EVALUATION_VERSION) throw new Error('verified scorecard refuses a mixed source evaluation version');
  if (!evaluationIsIntact(evaluation)) throw new Error('verified scorecard refuses a source evaluation that does not revalidate');
  if (!canonicalTimestamp(evaluation.created_at) || Date.parse(evaluation.created_at) > derivationEpoch) throw new Error('verified scorecard refuses a source evaluation with a future timestamp');
  if (evaluation.created_at > cutoff.createdAt || (evaluation.created_at === cutoff.createdAt && evaluation.id > cutoff.id)) throw new Error('verified scorecard refuses a source evaluation beyond the cutoff');
  const corrections = getOutcomeCorrections(evaluation.id);
  // A corrected evaluation is disputed evidence. The contract requires corrected sources to fail
  // closed rather than be aggregated, so the correction head is recorded in lineage but a non-null
  // head refuses the snapshot outright.
  const correctionHead = corrections.at(-1) || null;
  if (correctionHead) throw new Error('verified scorecard refuses a corrected source evaluation');
  const events = getOutcomeSourceEvents(evaluation.id);
  // `hasOwn`, not `in`: `in` walks the prototype chain, so an event type of `toString` or
  // `constructor` would pass an `in` guard and then index a function into a metric key.
  for (const event of events) if (!Object.hasOwn(EVENT_COUNTERS, event.event_type)) throw new Error('verified scorecard refuses an unknown source event type');
  const eventTypes = new Set(events.map((event) => event.event_type));
  // Milestone 3A permits both an acceptance and a rejection to be appended to one evaluation.
  // Aggregating that would silently resolve a contradiction in the favorable direction, so
  // contradictory acceptance evidence fails the snapshot closed.
  if (eventTypes.has('accepted') && (eventTypes.has('rejected') || eventTypes.has('partially_accepted'))) throw new Error('verified scorecard refuses contradictory acceptance evidence');
  return { evaluation, events, eventTypes, correctionHead, dimensions: dimensionsOf(evaluation) };
}

// Every dimension comes from the evaluation's own immutable evidence, which the provenance digest
// already covers. An absent dimension becomes the explicit unknown sentinel, never an omitted field
// and never a collapsed empty string; malformed evidence refuses rather than degrading to unknown.
function dimensionsOf(evaluation) {
  const classification = parsedJson(evaluation.classification);
  const routing = evaluation.routing_decision_id ? getRoutingDecision(evaluation.routing_decision_id, evaluation.run_id) : null;
  if (evaluation.routing_decision_id && !routing) throw new Error('verified scorecard refuses a source evaluation with missing routing evidence');
  if (classification !== null && !validDimensionClassification(classification)) throw new Error('verified scorecard refuses a malformed classification dimension');
  const capabilities = classification ? [...classification.requiredCapabilities].sort(compareStrings) : null;
  const dimensions = {
    providerId: evaluation.provider_id ?? UNKNOWN_DIMENSION,
    agentId: routing?.selected_agent ?? UNKNOWN_DIMENSION,
    capability: capabilities?.length ? canonicalJson(capabilities) : UNKNOWN_DIMENSION,
    // Capabilities are their own dimension, so the classification dimension carries only the four
    // scalar facets. Re-emitting through canonicalJson normalizes key order: the stored column
    // preserves insertion order and two logically identical classifications could otherwise differ.
    classification: classification ? canonicalJson({ complexity: classification.complexity, domain: classification.domain, risk: classification.risk, urgency: classification.urgency }) : UNKNOWN_DIMENSION,
  };
  if (dimensions.providerId !== UNKNOWN_DIMENSION && !safeId(dimensions.providerId)) throw new Error('verified scorecard refuses a malformed provider dimension');
  if (dimensions.agentId !== UNKNOWN_DIMENSION && !safeId(dimensions.agentId)) throw new Error('verified scorecard refuses a malformed agent dimension');
  if (capabilities && !capabilities.every(safeId)) throw new Error('verified scorecard refuses a malformed capability dimension');
  return dimensions;
}
function validDimensionClassification(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object' &&
    ['complexity', 'domain', 'risk', 'urgency'].every((facet) => typeof value[facet] === 'string' && value[facet].length > 0) &&
    Array.isArray(value.requiredCapabilities) && value.requiredCapabilities.length > 0;
}

// --- Derivation (m3b-v1) ---

// Exact integer counts only. There is no average and no float: a ratio is stored as a separate
// integer numerator and denominator, and a zero denominator means the ratio is not derivable rather
// than zero. Unknown is counted in its own column and never contributes to a success count.
function deriveMetrics(sources) {
  const metrics = {
    source_evaluation_count: sources.length,
    positive_eligible_count: 0, negative_terminal_count: 0, blocked_ineligible_count: 0,
    accepted_count: 0, rejected_count: 0, partially_accepted_count: 0, rollback_count: 0,
    follow_up_verification_count: 0, stability_confirmed_count: 0, regression_linked_count: 0,
    unknown_acceptance_count: 0, unknown_rollback_count: 0, unknown_stability_count: 0,
    retry_total: 0, known_retry_evaluations: 0, timeout_count: 0, unknown_timeout_count: 0, cancellation_count: 0,
    known_input_tokens: 0, known_input_token_evaluations: 0,
    known_output_tokens: 0, known_output_token_evaluations: 0,
    known_cost_cents: 0, known_cost_evaluations: 0,
    verified_success_numerator: 0, verified_success_denominator: 0,
    acceptance_numerator: 0, acceptance_denominator: 0,
  };
  for (const { evaluation, events, eventTypes } of sources) {
    if (evaluation.learning_eligibility === 'positive_eligible') metrics.positive_eligible_count += 1;
    else if (evaluation.learning_eligibility === 'ineligible_blocked') metrics.blocked_ineligible_count += 1;
    else if (evaluation.learning_eligibility === 'negative_factual') metrics.negative_terminal_count += 1;
    else throw new Error('verified scorecard refuses an unknown learning eligibility');
    for (const event of events) metrics[EVENT_COUNTERS[event.event_type]] += 1;
    // Milestone 3A never records an acceptance, rollback, or stability determination on the
    // evaluation row itself, so absence of evidence is unknown here - not a negative result.
    if ([...eventTypes].some((type) => ACCEPTANCE_EVENTS.has(type))) {
      metrics.acceptance_denominator += 1;
      if (eventTypes.has('accepted')) metrics.acceptance_numerator += 1;
    } else if (evaluation.acceptance_status === 'unavailable') metrics.unknown_acceptance_count += 1;
    if (!eventTypes.has('rollback') && evaluation.rollback_evidence === null) metrics.unknown_rollback_count += 1;
    if (!eventTypes.has('stability_confirmed') && evaluation.stability_evidence === null) metrics.unknown_stability_count += 1;
    // `timed_out` is a NOT NULL column that Milestone 3A writes as 0 when a run had no provider
    // invocation at all - which is unknown, not a confirmed non-timeout. The evaluation's own
    // component record says `unknown` in that case, so the absent invocation is the signal here and
    // an unknown timeout is counted in its own column rather than folded into zero.
    if (evaluation.provider_invocation_id === null) metrics.unknown_timeout_count += 1;
    else if (evaluation.timed_out === 1) metrics.timeout_count += 1;
    if (evaluation.cancelled === 1) metrics.cancellation_count += 1;
    // Retry gets the same known-denominator treatment as tokens and cost: a NULL retry count is
    // unknown and must not be summed as zero retries.
    if (evaluation.retry_count !== null) {
      metrics.retry_total = safeSum(metrics.retry_total, evaluation.retry_count);
      metrics.known_retry_evaluations += 1;
    }
    for (const [column, totalKey, countKey] of [['input_tokens', 'known_input_tokens', 'known_input_token_evaluations'], ['output_tokens', 'known_output_tokens', 'known_output_token_evaluations'], ['cost_cents', 'known_cost_cents', 'known_cost_evaluations']]) {
      if (evaluation[column] === null) continue;
      metrics[totalKey] = safeSum(metrics[totalKey], evaluation[column]);
      metrics[countKey] += 1;
    }
  }
  // Every source is a terminal evaluation, so the verified-success denominator is explicit and the
  // ratio is derivable whenever the group is non-empty.
  metrics.verified_success_numerator = metrics.positive_eligible_count;
  metrics.verified_success_denominator = metrics.source_evaluation_count;
  for (const [key, value] of Object.entries(metrics)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`verified scorecard refuses a malformed metric: ${key}`);
  }
  return metrics;
}

// The single definition of what the lineage digest covers: the version, the exact scope and
// dimensions, the cutoff, every ordered evaluation id and provenance digest, each selected
// correction head, the ordered source-event ids, and every persisted metric. Neither the snapshot id
// nor its wall-clock creation time is hashed, so an identical re-derivation reproduces an identical
// digest. Derivation and the read path both build the packet here so they cannot drift.
function lineagePacket({ scorecardVersion, scope, cutoff, lineage, metrics }) {
  const packet = { scorecardVersion, derivationVersion: SCORECARD_DERIVATION_VERSION, scope, cutoff, lineage, metrics };
  if (!digestibleValue(packet)) throw new Error('verified scorecard refuses a non-canonical lineage packet');
  return packet;
}
const contentPacket = (scorecardVersion, band, metrics) => ({ scorecardVersion, derivationVersion: SCORECARD_DERIVATION_VERSION, confidenceBand: band, metrics });

function persistGroup(group, workspaceId, cutoff, scorecardVersion) {
  const ordered = [...group.sources].sort((left, right) => compareStrings(sortKey(left), sortKey(right)));
  const evaluationIds = new Set();
  for (const source of ordered) {
    if (evaluationIds.has(source.evaluation.id)) throw new Error('verified scorecard refuses a duplicated source evaluation');
    evaluationIds.add(source.evaluation.id);
  }
  const metrics = deriveMetrics(ordered);
  const scope = {
    workspace_id: workspaceId, scorecard_version: scorecardVersion,
    dimension_provider_id: group.dimensions.providerId, dimension_agent_id: group.dimensions.agentId,
    dimension_capability: group.dimensions.capability, dimension_classification: group.dimensions.classification,
  };
  const lineage = ordered.map((source, index) => ({
    seq: index + 1, evaluationId: source.evaluation.id, evaluationCreatedAt: source.evaluation.created_at,
    provenanceDigest: source.evaluation.provenance_digest,
    correctionHead: source.correctionHead ? { id: source.correctionHead.id, version: Number(source.correctionHead.version) } : null,
    sourceEventIds: source.events.map((event) => event.id),
  }));
  const band = confidenceBand(metrics.source_evaluation_count);
  const cutoffPacket = { createdAt: cutoff.createdAt, id: cutoff.id };
  const lineageDigest = digest(lineagePacket({ scorecardVersion, scope, cutoff: cutoffPacket, lineage, metrics }));
  const contentDigest = digest(contentPacket(scorecardVersion, band, metrics));
  const existing = getVerifiedScorecardByIdentity(scope, cutoff.createdAt, cutoff.id);
  if (existing) {
    // Replay. An identical identity must reproduce identical derived content; if it does not, the
    // stored snapshot and the current evidence disagree and that is an integrity error, not an
    // update. Immutability triggers mean the stored row cannot be repaired in place.
    if (existing.lineage_digest !== lineageDigest || existing.content_digest !== contentDigest) throw new Error('verified scorecard identity conflicts with stored derived content');
    return existing;
  }
  const head = getVerifiedScorecardScopeHead(scope);
  const createdAt = now();
  const row = {
    ...scope, id: id('hscard'), derivation_version: SCORECARD_DERIVATION_VERSION,
    cutoff_created_at: cutoff.createdAt, cutoff_evaluation_id: cutoff.id,
    scope_version: head ? Number(head.scope_version) + 1 : 1,
    // A successor links to its predecessor and never touches it. The unique index on this column
    // keeps the chain linear, exactly as Milestone 3A does for correction chains.
    supersedes_scorecard_id: head ? head.id : null,
    confidence_band: band,
    ...metrics, lineage_digest: lineageDigest, content_digest: contentDigest, created_at: createdAt,
  };
  insertVerifiedScorecard(row, lineage.map((entry) => ({
    id: id('hscsrc'), scorecard_id: row.id, seq: entry.seq, evaluation_id: entry.evaluationId,
    workspace_id: workspaceId, evaluation_created_at: entry.evaluationCreatedAt,
    provenance_digest: entry.provenanceDigest,
    correction_head_id: entry.correctionHead?.id ?? null, correction_head_version: entry.correctionHead?.version ?? null,
    source_event_ids: canonicalJson(entry.sourceEventIds), created_at: createdAt,
  })));
  return getVerifiedScorecard(row.id);
}

// A stored snapshot is readable only when its persisted scope, dimensions, cutoff, complete ordered
// lineage, and metrics all still reproduce BOTH recorded digests. Checking only the content digest
// would leave dimensions, cutoff, and every lineage row unverified, so a snapshot could be
// re-attributed to another provider or handed back with forged lineage and still read as authentic.
//
// This is corruption and accident detection, not tamper resistance: both digests are unkeyed
// SHA-256 over fully persisted, public inputs, so an actor who can already write to these tables
// (which requires dropping the immutability triggers) can recompute them to match an edit. No later
// milestone may treat this as an integrity control against a database-write adversary.
function storedScorecardIntact(scorecard) {
  if (scorecard.scorecard_version !== SCORECARD_VERSION || scorecard.derivation_version !== SCORECARD_DERIVATION_VERSION) return false;
  if (!/^[a-f0-9]{64}$/.test(scorecard.lineage_digest) || !/^[a-f0-9]{64}$/.test(scorecard.content_digest)) return false;
  const sources = getVerifiedScorecardSources(scorecard.id);
  if (sources.length !== scorecard.source_evaluation_count) return false;
  if (sources.some((source, index) => Number(source.seq) !== index + 1 || source.workspace_id !== scorecard.workspace_id)) return false;
  const metrics = metricsOf(scorecard);
  if (scorecard.confidence_band !== confidenceBand(metrics.source_evaluation_count)) return false;
  if (scorecard.content_digest !== digest(contentPacket(scorecard.scorecard_version, scorecard.confidence_band, metrics))) return false;
  try {
    const lineage = sources.map((source) => ({
      seq: Number(source.seq), evaluationId: source.evaluation_id, evaluationCreatedAt: source.evaluation_created_at,
      provenanceDigest: source.provenance_digest,
      correctionHead: source.correction_head_id === null ? null : { id: source.correction_head_id, version: Number(source.correction_head_version) },
      sourceEventIds: JSON.parse(source.source_event_ids),
    }));
    const scope = {
      workspace_id: scorecard.workspace_id, scorecard_version: scorecard.scorecard_version,
      dimension_provider_id: scorecard.dimension_provider_id, dimension_agent_id: scorecard.dimension_agent_id,
      dimension_capability: scorecard.dimension_capability, dimension_classification: scorecard.dimension_classification,
    };
    const packet = lineagePacket({ scorecardVersion: scorecard.scorecard_version, scope, cutoff: { createdAt: scorecard.cutoff_created_at, id: scorecard.cutoff_evaluation_id }, lineage, metrics });
    return scorecard.lineage_digest === digest(packet);
  } catch { return false; }
}

const METRIC_COLUMNS = ['source_evaluation_count','positive_eligible_count','negative_terminal_count','blocked_ineligible_count','accepted_count','rejected_count','partially_accepted_count','rollback_count','follow_up_verification_count','stability_confirmed_count','regression_linked_count','unknown_acceptance_count','unknown_rollback_count','unknown_stability_count','retry_total','known_retry_evaluations','timeout_count','unknown_timeout_count','cancellation_count','known_input_tokens','known_input_token_evaluations','known_output_tokens','known_output_token_evaluations','known_cost_cents','known_cost_evaluations','verified_success_numerator','verified_success_denominator','acceptance_numerator','acceptance_denominator'];
function metricsOf(scorecard) { return Object.fromEntries(METRIC_COLUMNS.map((column) => [column, Number(scorecard[column])])); }

// --- Canonical helpers ---

// Node's SQLite driver returns INTEGER as a JS number, so a value past 2^53 would silently lose
// precision. Every addition is proven exact and refuses rather than storing a wrong total.
function safeSum(total, value) {
  const next = total + Number(value);
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || !Number.isSafeInteger(next)) throw new Error('verified scorecard refuses integer overflow');
  return next;
}
// Sorting is by UTF-16 code unit, never `localeCompare`, whose result depends on the host's ICU data
// and locale environment and would make a digest non-reproducible across machines.
function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function sortKey(source) { return `${source.evaluation.created_at} ${source.evaluation.id}`; }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function parsedJson(value) { try { return JSON.parse(value); } catch { return null; } }
