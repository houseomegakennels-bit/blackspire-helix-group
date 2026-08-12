import { workerRuntimeStatus, schedulerRuntimeStatus } from '../task-engine/runtime-status.js';

const state = (ok, negative = 'unavailable', positive = 'healthy') => ok === true ? positive : ok === false ? negative : 'unknown';

// Branch on the reported state BEFORE worker.ok. workerRuntimeStatus computes
// ok = !required || (...), and `required` is false unless BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT is
// set, so ok is true in a default deployment even when the worker is missing, stopped, or
// mid-drain. Testing ok first reported a dead worker as healthy and made the draining branch
// unreachable, discarding the signal this observation exists to carry. `required` only decides
// how loudly absence is reported, never whether it is noticed.
const ABSENT_WORKER_STATES = Object.freeze(['missing', 'stopped', 'unhealthy']);
const SANDBOX_TELEGRAM_MODES = Object.freeze(['disabled', 'sandbox', 'dry-run']);
const workerObservedState = (worker) => worker.state === 'stale' ? 'stale'
  : worker.state === 'draining' ? 'draining'
    : ABSENT_WORKER_STATES.includes(worker.state) ? (worker.required ? 'unavailable' : 'unknown')
      : worker.ok ? 'healthy' : 'unavailable';
const workerObservedReason = (worker) => worker.state === 'stale' ? 'heartbeat_stale'
  : worker.state === 'draining' ? 'drain_started'
    : ABSENT_WORKER_STATES.includes(worker.state) ? (worker.required ? 'check_failed' : 'observation_unknown')
      : worker.ok ? 'check_passed' : 'check_failed';
export function collectHealthObservations(context, sources = {}) {
  const base = { environment: context.environment, workspaceId: context.workspaceId, timestamp: context.timestamp, correlationId: context.correlationId, commit: context.commit, buildFingerprint: context.buildFingerprint, source: 'runtime', metadata: {} };
  const add = (component, componentState, reasonCode, reason, extra = {}) => ({ ...base, component, state: componentState, reasonCode, reason, ...extra });
  const worker = sources.worker || workerRuntimeStatus(sources.workerOptions);
  const scheduler = sources.scheduler || schedulerRuntimeStatus();
  return [
    add('api_liveness', state(sources.apiLiveness), sources.apiLiveness ? 'check_passed' : 'check_failed', 'API liveness observation'),
    add('api_readiness', state(sources.apiReadiness, 'unavailable', 'ready'), sources.apiReadiness ? 'check_passed' : 'check_failed', 'API readiness observation'),
    add('database', state(sources.database), sources.database ? 'check_passed' : 'dependency_unavailable', 'Database connectivity observation', { dependency: 'database' }),
    add('queue', state(sources.queue), sources.queue ? 'check_passed' : 'dependency_unavailable', 'Queue connectivity observation', { dependency: 'queue' }),
    add('worker', workerObservedState(worker), workerObservedReason(worker), 'Worker heartbeat observation'),
    add('scheduler', scheduler.state === 'disabled' ? 'disabled' : state(scheduler.ok), scheduler.state === 'disabled' ? 'unsupported' : scheduler.ok ? 'check_passed' : 'check_failed', scheduler.state === 'disabled' ? 'Scheduler capability is unsupported and disabled' : 'Scheduler status observation', { metadata: { supported: scheduler.state !== 'disabled' } }),
    add('migration', sources.migrationMatch ? 'healthy' : 'migration_mismatch', sources.migrationMatch ? 'check_passed' : 'version_mismatch', 'Migration version observation'),
    add('kill_switch', sources.killSwitch ? 'halted' : 'healthy', sources.killSwitch ? 'kill_switch_active' : 'check_passed', 'Kill-switch observation'),
    // Enabling a capability is not a failure. These previously had no healthy branch, so any
    // deployment that actually enabled providers or live Telegram reported dependency_failure
    // forever, pinning overall state to degraded and rollbackRecommendation to investigate --
    // an alarm that can never clear, which trains operators to ignore it. dependency_failure is
    // now reserved for an observed failure, reported explicitly by the caller.
    add('providers', sources.providersDisabled ? 'disabled' : sources.providersHealthy === false ? 'dependency_failure' : 'healthy', sources.providersDisabled ? 'capability_disabled' : sources.providersHealthy === false ? 'check_failed' : 'check_passed', 'External-provider capability observation'),
    add('telegram', SANDBOX_TELEGRAM_MODES.includes(sources.telegramMode) ? 'disabled' : sources.telegramHealthy === false ? 'dependency_failure' : 'healthy', SANDBOX_TELEGRAM_MODES.includes(sources.telegramMode) ? 'sandbox_active' : sources.telegramHealthy === false ? 'check_failed' : 'check_passed', 'Telegram transport observation', { metadata: { mode: sources.telegramMode } }),
    add('build', sources.fingerprintMatch ? 'healthy' : 'dependency_failure', sources.fingerprintMatch ? 'check_passed' : 'check_failed', 'Build fingerprint observation'),
  ];
}
