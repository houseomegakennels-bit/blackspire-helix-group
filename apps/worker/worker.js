import { claimNext, getFlag } from '../../packages/task-engine/tasks.js';
import { processTask } from '../../packages/hermes/hermes.js';
import { drainTelegramOutbox } from '../../packages/unified-input/unified.js';
import { dispatchReply } from '../telegram/bot.js';

export function startWorker({ intervalMs = Number(process.env.WORKER_POLL_MS || 750), once = false } = {}) {
  let running = false;
  async function tick() {
    if (running || getFlag('emergency_stop') === 'active') return;
    const task = claimNext({ workerId: process.env.WORKER_ID || 'worker-local' });
    if (!task) { await deliverEvents(); return; }
    running = true;
    try {
      await processTask(task);
    } finally {
      running = false;
      await deliverEvents();
    }
  }
  if (once) return tick();
  const timer = setInterval(tick, intervalMs);
  console.log(JSON.stringify({ service: 'worker', intervalMs }));
  return { stop: () => clearInterval(timer), tick };
}

async function deliverEvents() {
  return drainTelegramOutbox(async (reply) => {
    const result = await dispatchReply(process.env.TELEGRAM_BOT_TOKEN, reply);
    if (!result.sent) throw new Error(result.reason || 'telegram delivery failed');
    return result;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) startWorker();
