import { workerRuntimeStatus, schedulerRuntimeStatus } from '../task-engine/runtime-status.js';

const state = (ok, negative = 'unavailable', positive = 'healthy') => ok === true ? positive : ok === false ? negative : 'unknown';

// Branch on the reported state BEFORE worker.ok. workerRuntimeStatus computes
// ok = !required || (...), and `required` is false unless BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT is
// set, so ok is true in a default deployment even when the worker is missing, stopped, or
// mid-drain. Testing ok first reported a dead worker as healthy and made the draining branch
// unreachable, discarding the signal this observation exists to carry. `required` only decides
// how loudly absence is reported, never whether it is noticed.
const ABSENT_WORKER_STATES = Object.freeze(['missing', 'stopped', 'unhealthy']);
// Modes that provably do not reach the live Telegram API: 'mock' returns a fixture without
// sending (apps/telegram/bot.js), exactly as 'dry-run' does.
const SANDBOX_TELEGRAM_MODES = Object.freeze(['disabled', 'sandbox', 'dry-run', 'mock']);
const LIVE_TELEGRAM_MODES = Object.freeze(['polling', 'webhook']);
const workerObservedState = (worker) => worker.state === 'stale' ? 'stale'
  : worker.state === 'draining' ? 'draining'
    : worker.state === 'starting' ? 'starting'
      : ABSENT_WORKER_STATES.includes(worker.state) ? (worker.required ? 'unavailable' : 'unknown')
        : worker.ok ? 'healthy' : 'unavailable';
const workerObservedReason = (worker) => worker.state === 'stale' ? 'heartbeat_stale'
  : worker.state === 'draining' ? 'drain_started'
    : worker.state === 'starting' ? 'startup_pending'
      : ABSENT_WORKER_STATES.includes(worker.state) ? (worker.required ? 'check_failed' : 'observation_unknown')
        : worker.ok ? 'check_passed' : 'check_failed';

// Tri-state, mirroring `state()` and the worker branch above: an observed failure is
// dependency_failure, an observed success is healthy, and an UNOBSERVED signal is unknown --
// never healthy. Reserving healthy for `=== true` keeps a caller that simply omits the field
// from silently asserting that live providers or live Telegram are working. An unrecognized
// telegramMode (casing drift, a typo, an unset value) is likewise unknown rather than a green
// live transport: this package is read during Gate-4-sensitive rehearsals, where a sandbox
// intent misreported as healthy live is the wrong direction to fail.
const capabilityState = (disabled, healthy) => disabled ? 'disabled' : healthy === false ? 'dependency_failure' : healthy === true ? 'healthy' : 'unknown';
const capabilityReason = (disabled, healthy, disabledReason) => disabled ? disabledReason : healthy === false ? 'check_failed' : healthy === true ? 'check_passed' : 'observation_unknown';
const telegramSandboxed = (mode) => SANDBOX_TELEGRAM_MODES.includes(mode);
// A live mode with no explicit health signal stays unknown; an unrecognized mode is never live.
const telegramHealth = (mode, healthy) => LIVE_TELEGRAM_MODES.includes(mode) ? healthy : healthy === false ? false : undefined;
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
    add('providers', capabilityState(sources.providersDisabled, sources.providersHealthy), capabilityReason(sources.providersDisabled, sources.providersHealthy, 'capability_disabled'), 'External-provider capability observation'),
    add('telegram', capabilityState(telegramSandboxed(sources.telegramMode), telegramHealth(sources.telegramMode, sources.telegramHealthy)), capabilityReason(telegramSandboxed(sources.telegramMode), telegramHealth(sources.telegramMode, sources.telegramHealthy), 'sandbox_active'), 'Telegram transport observation', typeof sources.telegramMode === 'string' ? { metadata: { mode: sources.telegramMode } } : {}),
    add('build', sources.fingerprintMatch ? 'healthy' : 'dependency_failure', sources.fingerprintMatch ? 'check_passed' : 'check_failed', 'Build fingerprint observation'),
  ];
}
