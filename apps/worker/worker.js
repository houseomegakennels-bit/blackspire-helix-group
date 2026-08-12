import { claimNext, getFlag, setFlag } from '../../packages/task-engine/tasks.js';
import { processTask } from '../../packages/hermes/hermes.js';
import { drainTelegramOutbox } from '../../packages/unified-input/unified.js';
import { dispatchReply } from '../telegram/bot.js';
import { assertSchemaCompatible, closeDb } from '../../packages/task-engine/db.js';

export function startWorker({
  intervalMs = Number(process.env.WORKER_POLL_MS || 750), once = false,
  claimNextImpl = claimNext, processTaskImpl = processTask, deliverEventsImpl = deliverEvents,
  scheduledFailureImpl = (error) => console.error(JSON.stringify({ service: 'worker', fatal: true, error: sanitizeWorkerError(error) })),
} = {}) {
  assertSchemaCompatible();
  let stopping = false;
  let activeTick = null;
  async function executeTick() {
    if (getFlag('emergency_stop') === 'active') return;
    if (process.env.UNIFIED_IPHONE_TEST_MODE === 'true' && getFlag('test_worker_hold') === 'active') { await deliverEventsImpl(); return; }
    const task = claimNextImpl({ workerId: process.env.WORKER_ID || 'worker-local' });
    if (!task) { await deliverEventsImpl(); return; }
    try { await processTaskImpl(task); }
    finally { await deliverEventsImpl(); }
  }
  function tick() {
    if (stopping) return Promise.resolve();
    if (activeTick) return activeTick;
    activeTick = executeTick().finally(() => { activeTick = null; });
    return activeTick;
  }
  if (once) return tick();
  const timer = setInterval(() => { void tick().catch(scheduledFailureImpl); }, intervalMs);
  console.log(JSON.stringify({ service: 'worker', intervalMs }));
  return {
    tick,
    async stop({ deadlineMs = 30_000 } = {}) {
      stopping = true;
      clearInterval(timer);
      if (!activeTick) return { drained: true };
      let timeout;
      const result = await Promise.race([
        activeTick.then(() => ({ drained: true }), (error) => ({ drained: true, error })),
        new Promise((resolve) => { timeout = setTimeout(() => resolve({ drained: false }), deadlineMs); }),
      ]);
      clearTimeout(timeout);
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
      const drainPauseMs = Number(process.env.UNIFIED_TEST_DRAIN_PAUSE_MS || 0);
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
