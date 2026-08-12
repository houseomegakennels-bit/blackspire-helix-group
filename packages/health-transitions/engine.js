import crypto from 'node:crypto';
import { observationDigest, validateObservation } from './model.js';

const RANK = { none: 0, observe: 1, investigate: 2, rollback_recommended: 3, operator_intervention_required: 4 };
function recommendation(observation) {
  // 'post_deploy' is the advisory verifier's OWN channel, deliberately separate from the runtime
  // components it reports about. It carries the same severity the verifier assigned, so routing it
  // to its own component does not soften it: dependency_failure is the verifier's 'operator
  // intervention required' arm and unavailable is its 'rollback recommended' arm. Without these two
  // lines both would fall through to the generic 'investigate' floor below -- a silent downgrade of
  // the two most serious post-deploy outcomes.
  if (observation.component === 'post_deploy') {
    if (observation.state === 'dependency_failure') return 'operator_intervention_required';
    if (observation.state === 'unavailable') return 'rollback_recommended';
  }
  if (observation.state === 'migration_mismatch' || (observation.component === 'build' && observation.state !== 'healthy')) return 'operator_intervention_required';
  if (observation.state === 'unavailable' && ['api_liveness','api_readiness','database','queue'].includes(observation.component)) return 'rollback_recommended';
  // Any OTHER component reported unavailable still needs a human. Without this floor an
  // unavailable non-core component fell through to 'none' while severity() called it critical
  // and summary() escalated overall state to unavailable -- a report telling the operator
  // UNAVAILABLE and `rollback none` on consecutive lines. It also inverted the worker flag:
  // a missing worker read unknown -> observe with BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT unset,
  // but unavailable -> none once the flag declared that the worker matters.
  if (observation.state === 'unavailable') return 'investigate';
  if (observation.state === 'dependency_failure' || observation.state === 'halted') return 'investigate';
  // draining/recovering belong here for the same reason they belong in summary()'s degraded arm:
  // leaving them to fall through to 'none' reproduced F1's contradiction in milder form, a report
  // reading DEGRADED on one line and `rollback none` on the next. Every other state in that arm
  // maps to at least observe.
  if (['degraded','stale','unknown','draining','recovering'].includes(observation.state)) return 'observe';
  return 'none';
}
function severity(state, component) {
  // The advisory channel's dependency_failure IS its 'operator intervention required' arm, the
  // most serious post-deploy outcome. Graded by state alone it scored 'warning' while the LESSER
  // 'rollback recommended' arm (unavailable) scored 'critical' -- the worst outcome rendering
  // less severe than a lesser one on every surface that pages off severity. recommendation()
  // already special-cases this component; severity() and summary()'s ladder have to agree with it
  // or the report contradicts itself again, in the same way this change set exists to prevent.
  if (component === 'post_deploy' && state === 'dependency_failure') return 'critical';
  if (['migration_mismatch','unavailable'].includes(state)) return 'critical';
  if (['dependency_failure','halted','stale'].includes(state)) return 'warning';
  if (['degraded','unknown','starting','recovering','draining'].includes(state)) return 'notice';
  return 'info';
}
function eventId(observation, previousState) {
  return crypto.createHash('sha256').update(`${observation.environment}\0${observation.workspaceId}\0${observation.component}\0${observation.timestamp}\0${previousState}\0${observation.state}`).digest('hex');
}

export class HealthTransitionEngine {
  constructor(store, { flapWindowMs = 300_000, flapThreshold = 4 } = {}) { this.store = store; this.flapWindowMs = flapWindowMs; this.flapThreshold = flapThreshold; }
  observe(input) {
    const observation = validateObservation(input); const previous = this.store.latest(observation.environment, observation.workspaceId, observation.component);
    if (previous && observation.timestampMs < previous.timestampMs) return { accepted: false, disposition: 'stale_rejected', latest: previous };
    if (previous && observation.timestampMs === previous.timestampMs && observationDigest(observation) !== observationDigest(previous)) return { accepted: false, disposition: 'timestamp_conflict_rejected', latest: previous };
    if (previous && observationDigest(observation) === observationDigest(previous)) return { accepted: true, disposition: 'duplicate_suppressed', latest: previous };
    this.store.setLatest(observation);
    if (previous && previous.state === observation.state) return { accepted: true, disposition: 'snapshot_refreshed', latest: observation };
    const priorEvents = this.store.events(observation.environment, observation.workspaceId)
      .filter((event) => event.component === observation.component && observation.timestampMs - event.timestampMs <= this.flapWindowMs && observation.timestampMs >= event.timestampMs);
    const flapping = priorEvents.length + 1 >= this.flapThreshold;
    const rollbackRecommendation = recommendation(observation);
    const event = this.store.append(Object.freeze({
      id: eventId(observation, previous?.state || 'unknown'), version: 1, component: observation.component,
      environment: observation.environment, workspaceId: observation.workspaceId, previousState: previous?.state || 'unknown', newState: observation.state,
      timestamp: observation.timestamp, timestampMs: observation.timestampMs, reasonCode: observation.reasonCode, reason: observation.reason,
      correlationId: observation.correlationId, commit: observation.commit, buildFingerprint: observation.buildFingerprint,
      dependency: observation.dependency, source: observation.source, metadata: observation.metadata,
      severity: severity(observation.state, observation.component), operatorActionRequired: RANK[rollbackRecommendation] >= RANK.investigate,
      rollbackRecommendation, flapping, automaticActionTaken: false,
    }));
    return { accepted: true, disposition: 'transition_recorded', latest: observation, event };
  }
  summary(environment, workspaceId) {
    const components = this.store.current(environment, workspaceId);
    const events = this.store.events(environment, workspaceId);
    let rollbackRecommendation = 'none';
    for (const item of components) { const candidate = recommendation(item); if (RANK[candidate] > RANK[rollbackRecommendation]) rollbackRecommendation = candidate; }
    // 'draining' and 'recovering' must appear in this ladder. They matched no arm and fell
    // through to the terminal 'starting', so a system shedding a worker rendered as
    // "... STARTING / rollback none" -- indistinguishable from a healthy fresh boot at exactly
    // the moment it is losing capacity. severity() already classifies both as notice.
    const state = components.some((item) => ['unavailable','migration_mismatch'].includes(item.state) || (item.component === 'post_deploy' && item.state === 'dependency_failure')) ? 'unavailable'
      : components.some((item) => ['degraded','dependency_failure','stale','halted','unknown','draining','recovering'].includes(item.state)) ? 'degraded'
        : components.length && components.every((item) => ['healthy','ready','disabled'].includes(item.state)) ? 'healthy' : 'starting';
    // Append order is NOT timestamp order. observe() rejects a stale observation only per
    // component (see the stale guard above), so an observation for a *different* component may
    // legitimately arrive carrying an older timestamp. Taking events.at(-1) therefore reported
    // whichever event was recorded last, which diagnostics.js then published as
    // latestMeaningfulTransition and formatter.js printed as "Last transition:" -- while
    // history[0], sorted by time in the same payload, showed a newer and more severe event.
    // That is the same self-contradicting operator report this change set exists to remove, so
    // select by (timestampMs, id) using the identical ordering diagnostics.js applies.
    const latestTransition = events.reduce((newest, event) => !newest
      || event.timestampMs > newest.timestampMs
      || (event.timestampMs === newest.timestampMs && event.id.localeCompare(newest.id) > 0) ? event : newest, null);
    return { environment, workspaceId, state, rollbackRecommendation, components, latestTransition,
      staleComponents: components.filter((item) => item.state === 'stale').map((item) => item.component),
      flappingComponents: [...new Set(events.filter((event) => event.flapping).map((event) => event.component))], automaticActionTaken: false };
  }
}
