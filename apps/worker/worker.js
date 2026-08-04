import { claimNext, getFlag, setFlag } from '../../packages/task-engine/tasks.js';
import { processTask } from '../../packages/hermes/hermes.js';
import { drainTelegramOutbox } from '../../packages/unified-input/unified.js';
import { dispatchReply } from '../telegram/bot.js';
import { assertSchemaCompatible, closeDb } from '../../packages/task-engine/db.js';

export function startWorker({
  intervalMs = Number(process.env.WORKER_POLL_MS || 750), once = false,
  claimNextImpl = claimNext, processTaskImpl = processTask, deliverEventsImpl = deliverEvents,
} = {}) {
  try {
    assertSchemaCompatible();
  } catch (error) {
    console.error(JSON.stringify({ service: 'worker', fatal: true, error: String(error.message || error) }));
    process.exit(1);
  }
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
  const timer = setInterval(() => { void tick(); }, intervalMs);
  console.log(JSON.stringify({ service: 'worker', intervalMs }));
  return {
    tick,
    async stop({ deadlineMs = 30_000 } = {}) {
      stopping = true;
      clearInterval(timer);
      if (!activeTick) return { drained: true };
      let timeout;
      const result = await Promise.race([
        activeTick.then(() => ({ drained: true })),
        new Promise((resolve) => { timeout = setTimeout(() => resolve({ drained: false }), deadlineMs); }),
      ]);
      clearTimeout(timeout);
      return result;
    },
  };
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
  const worker = startWorker();
  let signalReceived = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (signalReceived) process.exit(1);
    signalReceived = true;
    console.log(JSON.stringify({ service: 'worker', lifecycle: 'draining', signal }));
    const result = await worker.stop();
    closeDb();
    if (!result.drained) console.error(JSON.stringify({ service: 'worker', lifecycle: 'drain_timeout' }));
    process.exit(result.drained ? 0 : 1);
  });
}
