import { claimNext, getFlag, getTask, setFlag } from '../../packages/task-engine/tasks.js';
import { processTask } from '../../packages/hermes/hermes.js';
import { drainTelegramOutbox } from '../../packages/unified-input/unified.js';
import { dispatchReply } from '../telegram/bot.js';
import { assertSchemaCompatible, closeDb } from '../../packages/task-engine/db.js';
import { recordWorkerHeartbeat, workerRuntimeStatus } from '../../packages/task-engine/runtime-status.js';

export function startWorker({
  intervalMs = Number(process.env.WORKER_POLL_MS || 750), once = false,
  claimNextImpl = claimNext, processTaskImpl = processTask, deliverEventsImpl = deliverEvents,
  scheduledFailureImpl = (error) => console.error(JSON.stringify({ service: 'worker', fatal: true, error: sanitizeWorkerError(error) })),
  heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 10_000),
  recordHeartbeatImpl = recordWorkerHeartbeat, getTaskImpl = getTask,
} = {}) {
  assertSchemaCompatible();
  let stopping = false;
  let activeTick = null;
  const workerId = process.env.WORKER_ID || 'worker-local';
  const startedAt = new Date().toISOString();
  let activeTaskId = null;
  const heartbeat = (phase) => recordHeartbeatImpl({ workerId, phase, taskId: activeTaskId, startedAt });
  // Heartbeat writes are observability, never a reason to lose a task. On the timer and shutdown
  // paths there is no enclosing catch, so a synchronous DB fault (SQLITE_BUSY, disk full, closed
  // handle) would kill the process outright and skip the graceful drain. Those paths use this.
  const safeHeartbeat = (phase) => {
    try { heartbeat(phase); }
    catch (error) { console.error(JSON.stringify({ service: 'worker', lifecycle: 'heartbeat_failed', error: sanitizeWorkerError(error) })); }
  };
  const previous = workerRuntimeStatus({ workerId });
  heartbeat('starting');
  if (previous.restartDetected) console.warn(JSON.stringify({ service: 'worker', lifecycle: 'restart_after_stale_heartbeat' }));
  async function executeTick() {
    heartbeat('idle');
    if (getFlag('emergency_stop') === 'active') return;
    if (process.env.UNIFIED_IPHONE_TEST_MODE === 'true' && getFlag('test_worker_hold') === 'active') { await deliverEventsImpl(); return; }
    const task = claimNextImpl({ workerId });
    if (!task) { await deliverEventsImpl(); return; }
    activeTaskId = task.id;
    // Guarded: the task is already claimed here, so a transient SQLITE_BUSY on this write would
    // otherwise skip the finally block (leaving the outbox undrained and activeTaskId pinned, so
    // the timer keeps publishing 'working' for a task that is not running) and drain the process
    // on a self-clearing fault, stranding the task until claimNext's 300s stale reclaim.
    safeHeartbeat('working');
    try {
      // A cancellation racing the atomic claim must be observed before provider dispatch.
      if (getTaskImpl(task.id)?.status !== 'cancelled') await processTaskImpl(task, { workerId, claimToken: task.claim_token });
    } finally {
      await deliverEventsImpl();
      activeTaskId = null;
      // Post-completion observability: the task is already done here, so a failed write must not
      // reject activeTick and turn a clean drain into a fatal exit 1. The pre-dispatch writes
      // above stay unguarded so a genuinely dead database still trips containment before work.
      safeHeartbeat(stopping ? 'draining' : 'idle');
    }
  }
  function tick() {
    if (stopping) return Promise.resolve();
    if (activeTick) return activeTick;
    activeTick = executeTick().finally(() => { activeTick = null; });
    return activeTick;
  }
  if (once) return tick().finally(() => safeHeartbeat('stopped'));
  const timer = setInterval(() => { void tick().catch(scheduledFailureImpl); }, intervalMs);
  const heartbeatTimer = setInterval(() => { safeHeartbeat(stopping ? 'draining' : activeTaskId ? 'working' : 'idle'); }, heartbeatIntervalMs);
  heartbeatTimer.unref();
  console.log(JSON.stringify({ service: 'worker', intervalMs }));
  return {
    tick,
    async stop({ deadlineMs = 30_000 } = {}) {
      stopping = true;
      clearInterval(timer);
      clearInterval(heartbeatTimer);
      safeHeartbeat('draining');
      if (!activeTick) { safeHeartbeat('stopped'); return { drained: true }; }
      let timeout;
      const result = await Promise.race([
        activeTick.then(() => ({ drained: true }), (error) => ({ drained: true, error })),
        new Promise((resolve) => { timeout = setTimeout(() => resolve({ drained: false }), deadlineMs); }),
      ]);
      clearTimeout(timeout);
      safeHeartbeat(result.drained ? 'stopped' : 'unhealthy');
      return result;
    },
  };
}

export function sanitizeWorkerError(error) {
  return String(error?.message || error || 'worker failure').replace(/(?:token|secret|password|key)\s*[=:]\s*\S+/gi, '[redacted]');
}

async function deliverEvents() {
  return drainTelegramOutbox(async (reply) => {
    const failures = Number(getFlag('test_mock_delivery_failures') || 0);
    if (process.env.UNIFIED_IPHONE_TEST_MODE === 'true' && failures > 0) {
      setFlag('test_mock_delivery_failures', String(failures - 1));
      throw new Error('sanitized mock Telegram delivery failure');
    }
    const result = await dispatchReply(process.env.TELEGRAM_BOT_TOKEN, reply);
    if (!result.sent) throw new Error(result.reason || 'telegram delivery failed');
    return result;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let worker = null;
  let shutdownPromise = null;
  const shutdown = (signal, startupError) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (signal) console.log(JSON.stringify({ service: 'worker', lifecycle: 'draining', signal }));
      // Test-only seam: an idle worker drains instantly, so a second-signal regression could finish
      // the whole shutdown before the second signal was delivered and silently test nothing. This
      // holds the drain open long enough for the second signal to land deterministically.
      const drainPauseMs = Math.min(Number(process.env.UNIFIED_TEST_DRAIN_PAUSE_MS || 0) || 0, 10_000);
      if (drainPauseMs > 0) await new Promise((resolve) => setTimeout(resolve, drainPauseMs));
      let result = { drained: true, error: startupError };
      try {
        if (worker) result = await worker.stop();
        if (startupError && !result.error) result.error = startupError;
      }
      // worker.stop() rejecting means the drain did not complete; reporting drained:true here made
      // the lifecycle log claim a clean drain that never happened.
      catch (error) { result = { drained: false, error }; }
      finally { closeDb(); }
      // Only the deadline path is a timeout; a stop() rejection is reported by the fatal line below.
      if (!result.drained && !result.error) console.error(JSON.stringify({ service: 'worker', lifecycle: 'drain_timeout' }));
      if (result.error) console.error(JSON.stringify({ service: 'worker', fatal: true, error: sanitizeWorkerError(result.error) }));
      process.exitCode = result.drained && !result.error ? 0 : 1;
      return result;
    })();
    return shutdownPromise;
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (shutdownPromise) {
      console.error(JSON.stringify({ service: 'worker', fatal: true, error: 'second shutdown signal forced immediate termination' }));
      process.exit(1);
    }
    void shutdown(signal);
  });
  try {
    worker = startWorker({ scheduledFailureImpl: (error) => { void shutdown(null, error); } });
  } catch (error) {
    void shutdown(null, error);
  }
}
