import { workerRuntimeStatus, schedulerRuntimeStatus } from '../task-engine/runtime-status.js';

const state = (ok, negative = 'unavailable', positive = 'healthy') => ok === true ? positive : ok === false ? negative : 'unknown';
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
    add('worker', worker.state === 'stale' ? 'stale' : worker.ok ? 'healthy' : worker.state === 'draining' ? 'draining' : 'unavailable', worker.state === 'stale' ? 'heartbeat_stale' : worker.ok ? 'check_passed' : 'check_failed', 'Worker heartbeat observation'),
    add('scheduler', scheduler.state === 'disabled' ? 'disabled' : state(scheduler.ok), scheduler.state === 'disabled' ? 'unsupported' : scheduler.ok ? 'check_passed' : 'check_failed', scheduler.state === 'disabled' ? 'Scheduler capability is unsupported and disabled' : 'Scheduler status observation', { metadata: { supported: scheduler.state !== 'disabled' } }),
    add('migration', sources.migrationMatch ? 'healthy' : 'migration_mismatch', sources.migrationMatch ? 'check_passed' : 'version_mismatch', 'Migration version observation'),
    add('kill_switch', sources.killSwitch ? 'halted' : 'healthy', sources.killSwitch ? 'kill_switch_active' : 'check_passed', 'Kill-switch observation'),
    add('providers', sources.providersDisabled ? 'disabled' : 'dependency_failure', sources.providersDisabled ? 'capability_disabled' : 'check_failed', 'External-provider capability observation'),
    add('telegram', ['disabled','sandbox','dry-run'].includes(sources.telegramMode) ? 'disabled' : 'dependency_failure', ['disabled','sandbox','dry-run'].includes(sources.telegramMode) ? 'sandbox_active' : 'check_failed', 'Telegram transport observation', { metadata: { mode: sources.telegramMode } }),
    add('build', sources.fingerprintMatch ? 'healthy' : 'dependency_failure', sources.fingerprintMatch ? 'check_passed' : 'check_failed', 'Build fingerprint observation'),
  ];
}
