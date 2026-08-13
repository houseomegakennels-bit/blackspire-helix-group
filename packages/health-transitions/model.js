import crypto from 'node:crypto';

export const HEALTH_STATES = Object.freeze(['starting','healthy','ready','degraded','unavailable','disabled','draining','halted','recovering','stale','migration_mismatch','dependency_failure','unknown']);
export const COMPONENTS = Object.freeze(['api_liveness','api_readiness','database','queue','worker','scheduler','migration','kill_switch','providers','telegram','build','startup','shutdown','post_deploy']);
export const REASON_CODES = Object.freeze(['startup_pending','startup_complete','check_passed','check_failed','dependency_unavailable','heartbeat_stale','heartbeat_recovered','version_mismatch','kill_switch_active','capability_disabled','sandbox_active','drain_started','shutdown_complete','unsupported','observation_unknown']);
export const SOURCES = Object.freeze(['api','worker','monitor','preflight','post_deploy_verifier','operator_fixture','runtime']);
export const ENVIRONMENTS = Object.freeze(['development','test','disposable-staging','staging','production']);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SECRET = /(?:secret|token|credential|authorization|cookie|session|csrf|private.?key|api.?key|bearer|password|ghp_|github_pat_|sk-)/i;
const METADATA_KEYS = new Set(['attempt','threshold','ageBucket','mode','supported','versionStatus']);

function boundedId(value, name) {
  if (typeof value !== 'string' || !ID.test(value) || SECRET.test(value)) throw new Error(`invalid ${name}`);
  return value;
}

export function redactMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata must be an object');
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEYS.has(key)) continue;
    const text = String(value);
    safe[key] = text.length <= 64 && !SECRET.test(text) ? text : '[REDACTED]';
  }
  return safe;
}

export function validateObservation(input) {
  if (!input || typeof input !== 'object') throw new Error('observation must be an object');
  const state = String(input.state || ''); const component = String(input.component || '');
  const environment = String(input.environment || ''); const reasonCode = String(input.reasonCode || '');
  const source = String(input.source || ''); const timestampMs = Date.parse(input.timestamp || '');
  if (!HEALTH_STATES.includes(state)) throw new Error('invalid health state');
  if (!COMPONENTS.includes(component)) throw new Error('invalid component');
  if (!ENVIRONMENTS.includes(environment)) throw new Error('invalid environment');
  if (!REASON_CODES.includes(reasonCode)) throw new Error('invalid reason code');
  if (!SOURCES.includes(source)) throw new Error('invalid observation source');
  if (!Number.isFinite(timestampMs)) throw new Error('invalid observation timestamp');
  const reason = String(input.reason || '').trim();
  if (!reason || reason.length > 240 || SECRET.test(reason)) throw new Error('reason must be bounded and redacted');
  const commit = String(input.commit || '');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('invalid commit fingerprint');
  const buildFingerprint = boundedId(input.buildFingerprint, 'build fingerprint');
  return Object.freeze({
    component, environment, workspaceId: boundedId(input.workspaceId, 'workspace id'), state,
    timestamp: new Date(timestampMs).toISOString(), timestampMs, reasonCode, reason,
    correlationId: boundedId(input.correlationId, 'correlation id'), commit, buildFingerprint,
    dependency: input.dependency === null || input.dependency === undefined ? null : boundedId(input.dependency, 'dependency'),
    source, metadata: Object.freeze(redactMetadata(input.metadata)),
  });
}

export function observationDigest(observation) {
  return crypto.createHash('sha256').update(JSON.stringify(observation)).digest('hex');
}
